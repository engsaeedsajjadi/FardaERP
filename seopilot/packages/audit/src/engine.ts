import { isIndexableOk } from "./rules/_helpers";
import { ALL_RULES } from "./rules";
import { SCORING_VERSION, rulePenalty, scoreCategories } from "./scoring";
import type { AuditContext, AuditInput, AuditPage, AuditResult, Finding, FindingDraft, RuleDefinition, RuleResult, Severity } from "./types";

export interface RunAuditOptions {
  /** Restrict to these rule ids (e.g. per-plan or user-disabled rules). Default: all. */
  enabledRuleIds?: Iterable<string>;
  /** Hard cap on findings per rule to bound memory on huge sites. */
  maxFindingsPerRule?: number;
  rules?: readonly RuleDefinition[];
}

export function buildContext(input: AuditInput): AuditContext {
  const byUrl = new Map<string, AuditPage>();
  for (const p of input.pages) if (!byUrl.has(p.normalizedUrl)) byUrl.set(p.normalizedUrl, p);

  const inbound = new Map<string, number>();
  const followedInbound = new Set<string>();
  const anyInbound = new Set<string>();
  for (const p of input.pages) {
    if (!p.isHtml || p.statusCode !== 200) continue;
    const seenTargets = new Set<string>();
    for (const l of p.links) {
      if (!l.isInternal || l.targetNormalizedUrl === p.normalizedUrl || seenTargets.has(l.targetNormalizedUrl)) continue;
      seenTargets.add(l.targetNormalizedUrl);
      inbound.set(l.targetNormalizedUrl, (inbound.get(l.targetNormalizedUrl) ?? 0) + 1);
      anyInbound.add(l.targetNormalizedUrl);
      if (!l.isNofollow) followedInbound.add(l.targetNormalizedUrl);
    }
  }
  const inboundNofollowOnly = new Set([...anyInbound].filter((u) => !followedInbound.has(u)));
  const sitemapSet = new Set(input.site.sitemapEntries.map((e) => e.normalizedUrl));
  const htmlPages = input.pages.filter((p) => p.isHtml && p.statusCode !== null && p.statusCode >= 200 && p.statusCode < 300);
  const indexablePages = htmlPages.filter((p) => p.isIndexable);
  const homepage = byUrl.get(input.site.finalStartUrl) ?? input.pages.find((p) => p.depth === 0) ?? null;
  const statusOf = (u: string): number | null | undefined => {
    const page = byUrl.get(u);
    if (page) return page.fetchClass === "skipped_robots" ? undefined : page.statusCode;
    return input.externalLinkStatus.has(u) ? input.externalLinkStatus.get(u) : undefined;
  };
  return { ...input, byUrl, inbound, inboundNofollowOnly, sitemapSet, indexablePages, htmlPages, statusOf, homepage };
}

function toArray(r: FindingDraft[] | FindingDraft | null | undefined): FindingDraft[] {
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

export function runAudit(input: AuditInput, options: RunAuditOptions = {}): AuditResult {
  const started = Date.now();
  const ctx = buildContext(input);
  const enabled = options.enabledRuleIds ? new Set(options.enabledRuleIds) : null;
  const cap = options.maxFindingsPerRule ?? 5000;
  const rules = (options.rules ?? ALL_RULES).filter((r) => !enabled || enabled.has(r.id));

  const findings: Finding[] = [];
  const results: RuleResult[] = [];
  const issueCounts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, notice: 0 };

  for (const rule of rules) {
    const t0 = Date.now();
    const drafts: FindingDraft[] = [];
    let applicable = 0;
    let error: string | null = null;
    try {
      if (rule.scope === "site") {
        applicable = 1;
        drafts.push(...toArray(rule.checkSite!(ctx)));
      } else {
        const applies = rule.appliesTo ?? isIndexableOk;
        for (const page of input.pages) {
          if (!applies(page, ctx)) continue;
          applicable++;
          if (drafts.length >= cap) continue;
          drafts.push(...toArray(rule.checkPage!(page, ctx)));
        }
      }
    } catch (err) {
      // A rule bug must never take down the audit; it is reported, not hidden.
      error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }

    const seenKeys = new Set<string>();
    let affectedPages = new Set<string | null>();
    for (const d of drafts.slice(0, cap)) {
      const dedupeKey = d.dedupeKey ?? d.pageUrl ?? "site";
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      affectedPages.add(d.pageUrl);
      findings.push({ ...d, dedupeKey, ruleId: rule.id, category: rule.category, severity: rule.severity });
      issueCounts[rule.severity]++;
    }
    // Ratio is by affected *pages* (a page with 40 broken links counts once), bounded by applicable pages.
    const affectedRatio = rule.scope === "site" ? (seenKeys.size ? 1 : 0) : applicable ? Math.min(1, affectedPages.size / applicable) : 0;
    results.push({
      ruleId: rule.id,
      category: rule.category,
      severity: rule.severity,
      weight: rule.weight,
      findings: seenKeys.size,
      applicable,
      affectedRatio: Math.round(affectedRatio * 10000) / 10000,
      penalty: error ? 0 : rulePenalty(rule.severity, rule.weight, affectedRatio),
      durationMs: Date.now() - t0,
      error,
    });
    affectedPages = new Set();
  }

  const { overall, breakdown } = scoreCategories(results);
  return {
    findings,
    rules: results,
    scoreOverall: overall,
    scoreBreakdown: breakdown,
    issueCounts,
    pagesEvaluated: input.pages.length,
    durationMs: Date.now() - started,
    scoringVersion: SCORING_VERSION,
  };
}

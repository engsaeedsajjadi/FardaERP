import { and, desc, eq, inArray, schema, sql, type Transaction } from "@seopilot/db";
import { locationByIso, type KeywordDataProvider, type KeywordIdeaRow, type MarketInput } from "@seopilot/providers";
import { AppError } from "@seopilot/shared";
import { assertCountLimit, consumeCredits, recordUsage } from "@seopilot/usage";
import { heuristicIntent, isQuestion, normalizeKeyword } from "./normalize";

export interface ProjectMarket {
  id: string;
  organizationId: string;
  country: string;
  language: string;
  locationCode: number | null;
  brandName: string | null;
  brandAliases: string[];
}

export async function loadProjectMarket(tx: Transaction, projectId: string): Promise<ProjectMarket> {
  const [p] = await tx.select({ id: schema.projects.id, organizationId: schema.projects.organizationId, country: schema.projects.country, language: schema.projects.language, locationCode: schema.projects.locationCode, brandName: schema.projects.brandName, brandAliases: schema.projects.brandAliases }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
  return p;
}

export function marketOf(p: ProjectMarket): MarketInput {
  const code = p.locationCode ?? locationByIso(p.country)?.code;
  if (!code) throw new AppError("VALIDATION_ERROR", `No location code for country ${p.country}`, { country: p.country });
  return { locationCode: code, languageCode: p.language };
}

export interface AddKeywordsInput {
  projectId: string;
  keywords: string[];
  userId: string;
  device?: "desktop" | "mobile";
  groupId?: string | null;
  tags?: string[];
  targetUrl?: string | null;
  country?: string;
  language?: string;
}

/** Add tracked keywords (deduped, plan-limited). Metrics are fetched later by a KEYWORD_REFRESH job. */
export async function addKeywords(tx: Transaction, input: AddKeywordsInput): Promise<{ added: number; skipped: number; ids: string[] }> {
  const project = await loadProjectMarket(tx, input.projectId);
  const unique = new Map<string, string>();
  for (const raw of input.keywords) {
    const n = normalizeKeyword(raw);
    if (n && n.length <= 200 && !unique.has(n)) unique.set(n, raw.trim());
  }
  if (unique.size === 0) throw new AppError("VALIDATION_ERROR", "No valid keywords supplied");
  const device = input.device ?? "desktop";
  const country = input.country ?? project.country;
  const language = input.language ?? project.language;
  const existing = await tx
    .select({ normalizedKeyword: schema.keywords.normalizedKeyword })
    .from(schema.keywords)
    .where(and(eq(schema.keywords.projectId, project.id), eq(schema.keywords.device, device), eq(schema.keywords.country, country), eq(schema.keywords.language, language), inArray(schema.keywords.normalizedKeyword, [...unique.keys()])));
  const have = new Set(existing.map((e) => e.normalizedKeyword));
  const toAdd = [...unique.entries()].filter(([n]) => !have.has(n));
  const supplied = input.keywords.length;
  if (toAdd.length === 0) return { added: 0, skipped: supplied, ids: [] };
  await assertCountLimit(tx, project.organizationId, "keywords", { adding: toAdd.length });
  const brand = [project.brandName, ...project.brandAliases].filter((b): b is string => Boolean(b));
  const rows = await tx
    .insert(schema.keywords)
    .values(
      toAdd.map(([normalizedKeyword, keyword]) => ({
        projectId: project.id,
        organizationId: project.organizationId,
        groupId: input.groupId ?? null,
        keyword,
        normalizedKeyword,
        country,
        language,
        locationCode: project.locationCode ?? locationByIso(country)?.code ?? null,
        device,
        isTracked: true,
        targetUrl: input.targetUrl ?? null,
        tags: [...new Set([...(input.tags ?? []), ...(isQuestion(keyword) ? ["question"] : [])])],
        intent: heuristicIntent(keyword, brand),
        intentSource: "heuristic",
        createdBy: input.userId,
      })),
    )
    .returning({ id: schema.keywords.id });
  // skipped = duplicates within the input + already-tracked + invalid entries
  return { added: rows.length, skipped: supplied - rows.length, ids: rows.map((r) => r.id) };
}

export async function removeKeywords(tx: Transaction, projectId: string, keywordIds: string[]): Promise<number> {
  if (!keywordIds.length) return 0;
  const rows = await tx.delete(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), inArray(schema.keywords.id, keywordIds))).returning({ id: schema.keywords.id });
  return rows.length;
}

/**
 * Refresh provider metrics for tracked keywords (worker). Stores a
 * keyword_metrics row per keyword and upgrades intent to provider-sourced.
 * Charges `keyword.metrics` credits per 10 keywords; idempotent per job.
 */
export async function refreshKeywordMetrics(tx: Transaction, provider: KeywordDataProvider, input: { projectId: string; keywordIds?: string[]; jobId: string }): Promise<{ refreshed: number; costUsd: number | null }> {
  const project = await loadProjectMarket(tx, input.projectId);
  const conds = [eq(schema.keywords.projectId, project.id)];
  if (input.keywordIds?.length) conds.push(inArray(schema.keywords.id, input.keywordIds));
  const kws = await tx.select({ id: schema.keywords.id, keyword: schema.keywords.keyword, normalizedKeyword: schema.keywords.normalizedKeyword, country: schema.keywords.country, language: schema.keywords.language }).from(schema.keywords).where(and(...conds));
  if (!kws.length) return { refreshed: 0, costUsd: null };
  // Group by (country, language) since metrics are market-specific.
  const groups = new Map<string, typeof kws>();
  for (const k of kws) {
    const key = `${k.country}|${k.language}`;
    groups.set(key, [...(groups.get(key) ?? []), k]);
  }
  let refreshed = 0;
  let costUsd: number | null = null;
  for (const [key, list] of groups) {
    const [country, language] = key.split("|") as [string, string];
    const code = locationByIso(country)?.code;
    if (!code) continue;
    await consumeCredits(tx, { organizationId: project.organizationId, projectId: project.id, operation: "keyword.metrics", quantity: list.length, provider: provider.name, referenceType: "job", referenceId: input.jobId, idempotencyKey: `kwmetrics:${input.jobId}:${key}` });
    const call = await provider.keywordMetrics(list.map((k) => k.normalizedKeyword), { locationCode: code, languageCode: language });
    if (call.cost.costUsd !== null) costUsd = (costUsd ?? 0) + call.cost.costUsd;
    const byKw = new Map(call.data.map((r) => [r.keyword.toLowerCase(), r]));
    for (const k of list) {
      const m = byKw.get(k.normalizedKeyword);
      if (!m) continue;
      await tx.insert(schema.keywordMetrics).values({ organizationId: project.organizationId, projectId: project.id, keywordId: k.id, keyword: k.normalizedKeyword, country, language, searchVolume: m.searchVolume, cpc: m.cpc, competition: m.competition, competitionLevel: m.competitionLevel, keywordDifficulty: m.keywordDifficulty, intent: m.intent, serpFeatures: m.serpFeatures, monthlySearches: m.monthlySearches, provider: call.provider, providerRequestId: call.cost.requestId });
      if (m.intent) await tx.update(schema.keywords).set({ intent: m.intent, intentSource: "provider", updatedAt: new Date() }).where(eq(schema.keywords.id, k.id));
      refreshed++;
    }
    await recordUsage(tx, { organizationId: project.organizationId, projectId: project.id, metric: "keyword_calls", quantity: 1, provider: provider.name });
  }
  return { refreshed, costUsd };
}

export type ResearchKind = "related" | "suggestions" | "ideas" | "site";

/** Keyword research (worker). Persists the run with results for history/export; charges `keyword.ideas`. */
export async function runKeywordResearch(tx: Transaction, provider: KeywordDataProvider, input: { projectId: string; kind: ResearchKind; seed: string; limit?: number; userId: string; jobId: string; country?: string; language?: string }): Promise<{ runId: string; results: KeywordIdeaRow[]; costUsd: number | null }> {
  const project = await loadProjectMarket(tx, input.projectId);
  const country = input.country ?? project.country;
  const language = input.language ?? project.language;
  const code = locationByIso(country)?.code;
  if (!code) throw new AppError("VALIDATION_ERROR", `Unsupported country ${country}`);
  const market = { locationCode: code, languageCode: language };
  const limit = Math.min(Math.max(input.limit ?? 200, 10), 1000);
  await consumeCredits(tx, { organizationId: project.organizationId, projectId: project.id, operation: "keyword.ideas", provider: provider.name, referenceType: "job", referenceId: input.jobId, idempotencyKey: `kwresearch:${input.jobId}` });
  const call =
    input.kind === "related" ? await provider.relatedKeywords(input.seed, market, limit)
    : input.kind === "suggestions" ? await provider.keywordSuggestions(input.seed, market, limit)
    : input.kind === "site" ? await provider.keywordsForSite(input.seed, market, limit)
    : await provider.keywordIdeas([input.seed], market, limit);
  const brand = [project.brandName, ...project.brandAliases].filter((b): b is string => Boolean(b));
  const results = call.data.map((r) => ({ ...r, intent: r.intent ?? heuristicIntent(r.keyword, brand) }));
  const [run] = await tx
    .insert(schema.keywordResearchRuns)
    .values({ projectId: project.id, organizationId: project.organizationId, kind: input.kind === "site" ? "competitor_domain" : input.kind === "ideas" ? "topic" : input.kind === "suggestions" ? "seed" : "related", input: { seed: input.seed, limit }, country, language, resultCount: results.length, results, provider: call.provider, providerRequestId: call.cost.requestId, costCredits: 5, createdBy: input.userId })
    .returning({ id: schema.keywordResearchRuns.id });
  await recordUsage(tx, { organizationId: project.organizationId, projectId: project.id, metric: "keyword_calls", quantity: 1, provider: provider.name });
  return { runId: run!.id, results, costUsd: call.cost.costUsd };
}

export async function latestMetricsForKeywords(tx: Transaction, keywordIds: string[]) {
  if (!keywordIds.length) return new Map<string, typeof schema.keywordMetrics.$inferSelect>();
  const rows = await tx
    .select()
    .from(schema.keywordMetrics)
    .where(inArray(schema.keywordMetrics.keywordId, keywordIds))
    .orderBy(desc(schema.keywordMetrics.fetchedAt));
  const out = new Map<string, typeof rows[number]>();
  for (const r of rows) if (r.keywordId && !out.has(r.keywordId)) out.set(r.keywordId, r);
  return out;
}

export async function keywordCounts(tx: Transaction, projectId: string): Promise<{ total: number; tracked: number; questions: number }> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int`, tracked: sql<number>`count(*) filter (where ${schema.keywords.isTracked})::int`, questions: sql<number>`count(*) filter (where ${schema.keywords.tags} ? 'question')::int` })
    .from(schema.keywords)
    .where(eq(schema.keywords.projectId, projectId));
  return { total: Number(row?.total ?? 0), tracked: Number(row?.tracked ?? 0), questions: Number(row?.questions ?? 0) };
}

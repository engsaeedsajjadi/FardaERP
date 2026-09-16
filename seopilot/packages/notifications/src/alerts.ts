/**
 * Alert rule evaluation (spec §34). Each evaluator reads MEASURED data already
 * in the database and returns triggered alerts; no thresholds are invented —
 * defaults are explicit and overridable per rule via `condition`.
 * Evaluation runs in the ALERT_PROCESSING job per organization.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, schema, sql, type Transaction } from "@seopilot/db";
import { dispatchNotification, type ChannelSpec } from "./dispatch";

export type AlertEvent = "rank_drop" | "rank_gain" | "clicks_drop" | "critical_issue" | "competitor_overtake" | "backlink_lost" | "credit_low" | "crawl_failed" | "report_ready" | "integration_needs_reauth";

export const ALERT_EVENTS: Array<{ event: AlertEvent; label: string; defaultCondition: Record<string, unknown> }> = [
  { event: "rank_drop", label: "Keyword position dropped", defaultCondition: { positions: 5, topN: 30 } },
  { event: "rank_gain", label: "Keyword position improved", defaultCondition: { positions: 5, topN: 10 } },
  { event: "clicks_drop", label: "Search Console clicks dropped", defaultCondition: { percent: 25, windowDays: 7 } },
  { event: "critical_issue", label: "New critical/high audit issues", defaultCondition: { minSeverity: "high" } },
  { event: "backlink_lost", label: "Backlinks lost", defaultCondition: { min: 1 } },
  { event: "credit_low", label: "Credit balance low", defaultCondition: {} },
  { event: "crawl_failed", label: "Crawl failed", defaultCondition: {} },
  { event: "integration_needs_reauth", label: "Google connection needs re-authorisation", defaultCondition: {} },
];

export interface TriggeredAlert {
  event: AlertEvent;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  data: Record<string, unknown>;
  /** Stable key so the same fact is not alerted twice within the cooldown. */
  dedupeKey: string;
}

type Rule = typeof schema.notificationRules.$inferSelect;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const day = (d: Date) => d.toISOString().slice(0, 10);

async function projectIds(tx: Transaction, rule: Rule): Promise<string[]> {
  if (rule.projectId) return [rule.projectId];
  return (await tx.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.organizationId, rule.organizationId), sql`${schema.projects.archivedAt} IS NULL`))).map((r) => r.id);
}

async function evalRank(tx: Transaction, rule: Rule, dir: "drop" | "gain", since: Date): Promise<TriggeredAlert[]> {
  const positions = num(rule.condition["positions"], 5), topN = num(rule.condition["topN"], dir === "drop" ? 30 : 10);
  const pids = await projectIds(tx, rule);
  if (!pids.length) return [];
  const rows = await tx
    .select({ keyword: schema.keywords.keyword, projectId: schema.keywords.projectId, position: schema.keywordRankings.position, previousPosition: schema.keywordRankings.previousPosition, checkedOn: schema.keywordRankings.checkedOn, url: schema.keywordRankings.url })
    .from(schema.keywordRankings)
    .innerJoin(schema.keywords, eq(schema.keywords.id, schema.keywordRankings.keywordId))
    .where(and(inArray(schema.keywords.projectId, pids), gte(schema.keywordRankings.checkedOn, day(since)), isNotNull(schema.keywordRankings.previousPosition)));
  const out: TriggeredAlert[] = [];
  for (const r of rows) {
    const prev = r.previousPosition!, cur = r.position;
    if (dir === "drop") {
      const dropped = cur === null ? prev <= topN : cur - prev >= positions && prev <= topN;
      if (dropped) out.push({ event: "rank_drop", severity: cur === null ? "critical" : "warning", title: `"${r.keyword}" dropped ${cur === null ? "out of the top 100" : `from #${prev} to #${cur}`}`, body: `Checked ${r.checkedOn}. ${r.url ? `Ranking URL: ${r.url}` : ""}`.trim(), data: { keyword: r.keyword, projectId: r.projectId, previous: prev, current: cur, checkedOn: r.checkedOn }, dedupeKey: `rank_drop:${r.projectId}:${r.keyword}:${r.checkedOn}` });
    } else if (cur !== null && prev - cur >= positions && cur <= topN) {
      out.push({ event: "rank_gain", severity: "info", title: `"${r.keyword}" improved from #${prev} to #${cur}`, body: `Checked ${r.checkedOn}.`, data: { keyword: r.keyword, projectId: r.projectId, previous: prev, current: cur }, dedupeKey: `rank_gain:${r.projectId}:${r.keyword}:${r.checkedOn}` });
    }
  }
  return out;
}

async function evalClicksDrop(tx: Transaction, rule: Rule): Promise<TriggeredAlert[]> {
  const percent = num(rule.condition["percent"], 25), windowDays = num(rule.condition["windowDays"], 7);
  const out: TriggeredAlert[] = [];
  for (const pid of await projectIds(tx, rule)) {
    const end = new Date(Date.now() - 2 * 86_400_000);
    const curFrom = new Date(end.getTime() - (windowDays - 1) * 86_400_000);
    const prevTo = new Date(curFrom.getTime() - 86_400_000), prevFrom = new Date(prevTo.getTime() - (windowDays - 1) * 86_400_000);
    const sum = async (from: Date, to: Date) => {
      const [r] = await tx.select({ clicks: sql<number>`COALESCE(SUM(${schema.gscMetrics.clicks}),0)::int`, days: sql<number>`COUNT(*)::int` }).from(schema.gscMetrics).where(and(eq(schema.gscMetrics.projectId, pid), eq(schema.gscMetrics.dimension, "date"), gte(schema.gscMetrics.date, day(from)), lte(schema.gscMetrics.date, day(to))));
      return { clicks: Number(r?.clicks ?? 0), days: Number(r?.days ?? 0) };
    };
    const cur = await sum(curFrom, end), prev = await sum(prevFrom, prevTo);
    if (cur.days < windowDays || prev.days < windowDays || prev.clicks < 20) continue; // insufficient data — never guess
    const change = ((cur.clicks - prev.clicks) / prev.clicks) * 100;
    if (change <= -percent) out.push({ event: "clicks_drop", severity: change <= -50 ? "critical" : "warning", title: `Organic clicks down ${Math.abs(Math.round(change))}% week over week`, body: `${cur.clicks} clicks (${day(curFrom)}–${day(end)}) vs ${prev.clicks} in the previous ${windowDays} days.`, data: { projectId: pid, current: cur.clicks, previous: prev.clicks, changePercent: Math.round(change) }, dedupeKey: `clicks_drop:${pid}:${day(end)}` });
  }
  return out;
}

async function evalCriticalIssues(tx: Transaction, rule: Rule, since: Date): Promise<TriggeredAlert[]> {
  const minSeverity = String(rule.condition["minSeverity"] ?? "high");
  const sev: Array<"critical" | "high"> = minSeverity === "critical" ? ["critical"] : ["critical", "high"];
  const out: TriggeredAlert[] = [];
  for (const pid of await projectIds(tx, rule)) {
    const runs = await tx.select({ id: schema.crawlRuns.id, finishedAt: schema.crawlRuns.finishedAt, score: schema.crawlRuns.scoreOverall }).from(schema.crawlRuns).where(and(eq(schema.crawlRuns.projectId, pid), eq(schema.crawlRuns.status, "completed"), gte(schema.crawlRuns.finishedAt, since))).orderBy(desc(schema.crawlRuns.finishedAt)).limit(1);
    const run = runs[0];
    if (!run) continue;
    const [r] = await tx.select({ n: sql<number>`COUNT(*)::int` }).from(schema.auditFindings).where(and(eq(schema.auditFindings.crawlRunId, run.id), eq(schema.auditFindings.firstSeenRunId, run.id), inArray(schema.auditFindings.severity, sev)));
    const n = Number(r?.n ?? 0);
    if (n > 0) out.push({ event: "critical_issue", severity: "critical", title: `${n} new ${minSeverity === "critical" ? "critical" : "critical/high"} SEO issue${n === 1 ? "" : "s"} found`, body: `Latest audit scored ${run.score ?? "n/a"}/100.`, data: { projectId: pid, crawlRunId: run.id, count: n }, dedupeKey: `critical_issue:${run.id}` });
  }
  return out;
}

async function evalBacklinkLost(tx: Transaction, rule: Rule, since: Date): Promise<TriggeredAlert[]> {
  const min = num(rule.condition["min"], 1);
  const out: TriggeredAlert[] = [];
  for (const pid of await projectIds(tx, rule)) {
    // Backlinks are marked lost by refreshBacklinks (isLost = true, lostAt set).
    const [r] = await tx.select({ n: sql<number>`COUNT(*)::int`, sample: sql<string[]>`(array_agg(${schema.backlinks.sourceUrl}))[1:5]` }).from(schema.backlinks).where(and(eq(schema.backlinks.projectId, pid), eq(schema.backlinks.isLost, true), gte(schema.backlinks.lostAt, since)));
    const n = Number(r?.n ?? 0);
    if (n >= min) out.push({ event: "backlink_lost", severity: "warning", title: `${n} backlink${n === 1 ? "" : "s"} lost`, body: (r?.sample ?? []).join("\n"), data: { projectId: pid, lost: n, sample: r?.sample ?? [] }, dedupeKey: `backlink_lost:${pid}:${day(new Date())}` });
  }
  return out;
}

async function evalCreditLow(tx: Transaction, rule: Rule): Promise<TriggeredAlert[]> {
  const [w] = await tx.select().from(schema.creditWallets).where(eq(schema.creditWallets.organizationId, rule.organizationId)).limit(1);
  if (!w || w.balance > w.lowBalanceThreshold) return [];
  return [{ event: "credit_low", severity: w.balance <= 0 ? "critical" : "warning", title: w.balance <= 0 ? "Credits exhausted" : `Credit balance low: ${w.balance}`, body: `Threshold ${w.lowBalanceThreshold}. Scheduled checks that need credits will be skipped until you top up.`, data: { balance: w.balance, threshold: w.lowBalanceThreshold }, dedupeKey: `credit_low:${rule.organizationId}:${day(new Date())}` }];
}

async function evalCrawlFailed(tx: Transaction, rule: Rule, since: Date): Promise<TriggeredAlert[]> {
  const pids = await projectIds(tx, rule);
  if (!pids.length) return [];
  const runs = await tx.select({ id: schema.crawlRuns.id, projectId: schema.crawlRuns.projectId, err: schema.crawlRuns.errorMessage }).from(schema.crawlRuns).where(and(inArray(schema.crawlRuns.projectId, pids), eq(schema.crawlRuns.status, "failed"), gte(schema.crawlRuns.finishedAt, since)));
  return runs.map((r) => ({ event: "crawl_failed" as const, severity: "warning" as const, title: "Site crawl failed", body: r.err ?? "Unknown error", data: { projectId: r.projectId, crawlRunId: r.id }, dedupeKey: `crawl_failed:${r.id}` }));
}

async function evalReauth(tx: Transaction, rule: Rule): Promise<TriggeredAlert[]> {
  const pids = await projectIds(tx, rule);
  if (!pids.length) return [];
  const out: TriggeredAlert[] = [];
  const gsc = await tx.select({ projectId: schema.gscConnections.projectId }).from(schema.gscConnections).where(and(inArray(schema.gscConnections.projectId, pids), eq(schema.gscConnections.status, "needs_reauth")));
  const ga4 = await tx.select({ projectId: schema.ga4Connections.projectId }).from(schema.ga4Connections).where(and(inArray(schema.ga4Connections.projectId, pids), eq(schema.ga4Connections.status, "needs_reauth")));
  for (const g of gsc) out.push({ event: "integration_needs_reauth", severity: "warning", title: "Search Console needs re-authorisation", body: "Google revoked or expired the connection. Reconnect to resume syncing.", data: { projectId: g.projectId, integration: "gsc" }, dedupeKey: `reauth:gsc:${g.projectId}:${day(new Date())}` });
  for (const g of ga4) out.push({ event: "integration_needs_reauth", severity: "warning", title: "Google Analytics needs re-authorisation", body: "Google revoked or expired the connection. Reconnect to resume syncing.", data: { projectId: g.projectId, integration: "ga4" }, dedupeKey: `reauth:ga4:${g.projectId}:${day(new Date())}` });
  return out;
}

export async function evaluateRule(tx: Transaction, rule: Rule, now = new Date()): Promise<TriggeredAlert[]> {
  const since = rule.lastTriggeredAt ?? new Date(now.getTime() - 2 * 86_400_000);
  switch (rule.event as AlertEvent) {
    case "rank_drop": return evalRank(tx, rule, "drop", since);
    case "rank_gain": return evalRank(tx, rule, "gain", since);
    case "clicks_drop": return evalClicksDrop(tx, rule);
    case "critical_issue": return evalCriticalIssues(tx, rule, since);
    case "backlink_lost": return evalBacklinkLost(tx, rule, since);
    case "credit_low": return evalCreditLow(tx, rule);
    case "crawl_failed": return evalCrawlFailed(tx, rule, since);
    case "integration_needs_reauth": return evalReauth(tx, rule);
    default: return [];
  }
}

/** Alerts already emitted (by dedupeKey stored in notification.data) — prevents repeats across runs. */
async function alreadySent(tx: Transaction, organizationId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await tx.select({ key: sql<string>`${schema.notifications.data}->>'dedupeKey'` }).from(schema.notifications).where(and(eq(schema.notifications.organizationId, organizationId), inArray(sql`${schema.notifications.data}->>'dedupeKey'`, keys)));
  return new Set(rows.map((r) => r.key));
}

export async function memberEmails(tx: Transaction, organizationId: string): Promise<string[]> {
  const rows = await tx.select({ email: schema.users.email }).from(schema.organizationMembers).innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId)).where(and(eq(schema.organizationMembers.organizationId, organizationId), inArray(schema.organizationMembers.role, ["owner", "admin", "manager", "seo_manager"])));
  return rows.map((r) => r.email);
}

/**
 * Evaluate all enabled rules of an organization, respecting cooldowns and
 * dedupe keys; dispatch to channels. Returns counts for the job result.
 */
export async function processAlertsForOrganization(tx: Transaction, organizationId: string, opts: { now?: Date; dispatch?: typeof dispatchNotification } = {}): Promise<{ evaluated: number; triggered: number; suppressed: number }> {
  const now = opts.now ?? new Date();
  const dispatch = opts.dispatch ?? dispatchNotification;
  const rules = await tx.select().from(schema.notificationRules).where(and(eq(schema.notificationRules.organizationId, organizationId), eq(schema.notificationRules.isEnabled, true)));
  let triggered = 0, suppressed = 0;
  const emails = await memberEmails(tx, organizationId);
  for (const rule of rules) {
    const alerts = await evaluateRule(tx, rule, now);
    if (!alerts.length) continue;
    const inCooldown = rule.lastTriggeredAt !== null && now.getTime() - rule.lastTriggeredAt.getTime() < rule.cooldownMinutes * 60_000;
    const sent = await alreadySent(tx, organizationId, alerts.map((a) => a.dedupeKey));
    const fresh = alerts.filter((a) => !sent.has(a.dedupeKey));
    suppressed += alerts.length - fresh.length;
    if (!fresh.length) continue;
    if (inCooldown) {
      suppressed += fresh.length;
      continue;
    }
    // Batch many alerts of one rule into a single notification to avoid floods.
    const first = fresh[0]!;
    const title = fresh.length === 1 ? first.title : `${fresh.length} ${ALERT_EVENTS.find((e) => e.event === rule.event)?.label.toLowerCase() ?? rule.event} alerts`;
    const body = fresh.length === 1 ? first.body : fresh.slice(0, 10).map((a) => `• ${a.title}`).join("\n") + (fresh.length > 10 ? `\n…and ${fresh.length - 10} more` : "");
    const severity = fresh.some((a) => a.severity === "critical") ? "critical" : fresh.some((a) => a.severity === "warning") ? "warning" : "info";
    await dispatch({ organizationId, projectId: rule.projectId, ruleId: rule.id, event: rule.event, severity, title, body, data: { dedupeKey: first.dedupeKey, dedupeKeys: fresh.map((a) => a.dedupeKey), items: fresh.slice(0, 50).map((a) => a.data) }, channels: rule.channels as ChannelSpec[], emailRecipients: emails });
    // Record each dedupe key so the batch's individual facts are not re-alerted.
    if (fresh.length > 1) {
      await tx.insert(schema.notifications).values(fresh.slice(1).map((a) => ({ organizationId, projectId: rule.projectId, ruleId: rule.id, event: rule.event, severity: a.severity, title: a.title, body: a.body, data: { ...a.data, dedupeKey: a.dedupeKey, batchedUnderRule: rule.id }, readAt: now, deliveries: [{ channel: "dashboard", status: "skipped" as const, error: "batched", at: now.toISOString() }] })));
    }
    await tx.update(schema.notificationRules).set({ lastTriggeredAt: now, updatedAt: now }).where(eq(schema.notificationRules.id, rule.id));
    triggered += fresh.length;
  }
  return { evaluated: rules.length, triggered, suppressed };
}

/**
 * Rank tracking: one live SERP per (keyword, device, market) per day. Runs in
 * the worker (RANK_CHECK job). Every ranking row carries the provider, request
 * id and the SERP snapshot id it came from — positions are never estimated.
 */
import { and, desc, eq, inArray, lt, schema, sql, type Transaction } from "@seopilot/db";
import { findDomainRank, locationByIso, type SerpProvider } from "@seopilot/providers";
import { AppError } from "@seopilot/shared";
import { assertMonthlyLimit, consumeCredits, recordUsage } from "@seopilot/usage";

export interface RankCheckOutcome {
  runId: string;
  checked: number;
  failed: number;
  changes: RankChange[];
  costUsd: number | null;
  status: "completed" | "partial" | "failed";
}

export interface RankChange {
  keywordId: string;
  keyword: string;
  device: "desktop" | "mobile";
  previousPosition: number | null;
  position: number | null;
  url: string | null;
  delta: number | null;
}

function isoDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function createRankCheckRun(tx: Transaction, input: { projectId: string; organizationId: string; jobId: string | null; keywordCount: number; provider: string; triggeredBy: string }): Promise<string> {
  const [run] = await tx.insert(schema.rankCheckRuns).values({ projectId: input.projectId, organizationId: input.organizationId, jobId: input.jobId, status: "running", keywordCount: input.keywordCount, provider: input.provider, triggeredBy: input.triggeredBy, startedAt: new Date() }).returning({ id: schema.rankCheckRuns.id });
  return run!.id;
}

/**
 * Check one keyword. Separate transaction per keyword in the worker so a
 * provider failure for one keyword never rolls back the others.
 */
export async function checkKeywordRank(tx: Transaction, provider: SerpProvider, input: { runId: string; keywordId: string; projectDomain: string; jobId: string; checkedOn?: string }): Promise<RankChange> {
  const [k] = await tx.select().from(schema.keywords).where(eq(schema.keywords.id, input.keywordId)).limit(1);
  if (!k) throw new AppError("NOT_FOUND", "Keyword not found");
  const locationCode = k.locationCode ?? locationByIso(k.country)?.code;
  if (!locationCode) throw new AppError("VALIDATION_ERROR", `Unsupported country ${k.country}`);
  const checkedOn = input.checkedOn ?? isoDate();
  await assertMonthlyLimit(tx, k.organizationId, "rank_checks", 1);
  await consumeCredits(tx, { organizationId: k.organizationId, projectId: k.projectId, operation: "serp.check", provider: provider.name, referenceType: "job", referenceId: input.jobId, idempotencyKey: `serp:${input.jobId}:${k.id}:${checkedOn}` });

  const call = await provider.liveSerp(k.keyword, { locationCode, languageCode: k.language, device: k.device });
  const [serp] = await tx
    .insert(schema.serpResults)
    .values({ organizationId: k.organizationId, projectId: k.projectId, keywordId: k.id, query: k.keyword, searchEngine: k.searchEngine, country: k.country, language: k.language, locationCode, device: k.device, resultCount: call.data.resultCount, items: call.data.items, serpFeatures: call.data.serpFeatures, checkUrl: call.data.checkUrl, provider: call.provider, providerRequestId: call.cost.requestId, costCredits: 1 })
    .returning({ id: schema.serpResults.id });

  const rank = findDomainRank(call.data, input.projectDomain);
  const [prev] = await tx.select({ position: schema.keywordRankings.position }).from(schema.keywordRankings).where(and(eq(schema.keywordRankings.keywordId, k.id), lt(schema.keywordRankings.checkedOn, checkedOn))).orderBy(desc(schema.keywordRankings.checkedOn)).limit(1);
  const previousPosition = prev?.position ?? null;
  const topCompetitors = call.data.items.filter((i) => i.type === "organic" && i.domain && i.rank !== null && i.rank <= 10).map((i) => ({ domain: i.domain as string, url: i.url ?? "", position: i.rank as number }));

  await tx
    .insert(schema.keywordRankings)
    .values({ keywordId: k.id, projectId: k.projectId, organizationId: k.organizationId, rankCheckRunId: input.runId, serpResultId: serp?.id ?? null, checkedOn, position: rank.position, previousPosition, url: rank.url, searchEngine: k.searchEngine, country: k.country, language: k.language, device: k.device, serpFeatures: call.data.serpFeatures, competingUrls: rank.competing, topCompetitors, provider: call.provider, providerRequestId: call.cost.requestId })
    .onConflictDoUpdate({ target: [schema.keywordRankings.keywordId, schema.keywordRankings.checkedOn], set: { position: rank.position, previousPosition, url: rank.url, serpResultId: serp?.id ?? null, rankCheckRunId: input.runId, serpFeatures: call.data.serpFeatures, competingUrls: rank.competing, topCompetitors, fetchedAt: new Date() } });
  await recordUsage(tx, { organizationId: k.organizationId, projectId: k.projectId, metric: "rank_checks", quantity: 1, provider: call.provider });
  await recordUsage(tx, { organizationId: k.organizationId, projectId: k.projectId, metric: "serp_calls", quantity: 1, provider: call.provider });

  const delta = previousPosition !== null && rank.position !== null ? previousPosition - rank.position : null;
  return { keywordId: k.id, keyword: k.keyword, device: k.device, previousPosition, position: rank.position, url: rank.url, delta };
}

export async function finishRankCheckRun(tx: Transaction, runId: string, input: { checked: number; failed: number; costCredits: number; error?: string | null }): Promise<void> {
  const status = input.failed === 0 ? "completed" : input.checked === 0 ? "failed" : "partial";
  await tx.update(schema.rankCheckRuns).set({ status, checkedCount: input.checked, failedCount: input.failed, costCredits: input.costCredits, errorMessage: input.error ?? null, finishedAt: new Date() }).where(eq(schema.rankCheckRuns.id, runId));
}

export interface VisibilitySummary {
  date: string;
  tracked: number;
  ranked: number;
  top3: number;
  top10: number;
  top100: number;
  avgPosition: number | null;
  /** Σ CTR(position) × volume over tracked keywords with metrics; null when no metrics. */
  estimatedTraffic: number | null;
  /** 0–100: Σ visibility weight / Σ max weight. */
  visibilityIndex: number | null;
}

/** Empirical average organic CTR by position (Advanced Web Ranking style curve; documented in SEO-ENGINE.md). */
export const CTR_BY_POSITION: Record<number, number> = { 1: 0.274, 2: 0.155, 3: 0.107, 4: 0.077, 5: 0.058, 6: 0.045, 7: 0.036, 8: 0.03, 9: 0.026, 10: 0.023 };
export function ctrFor(position: number | null): number {
  if (position === null || position < 1) return 0;
  if (position <= 10) return CTR_BY_POSITION[position] ?? 0;
  if (position <= 20) return 0.01;
  return 0;
}

export async function visibilityForDate(tx: Transaction, projectId: string, date: string): Promise<VisibilitySummary> {
  const rows = await tx
    .select({ keywordId: schema.keywordRankings.keywordId, position: schema.keywordRankings.position })
    .from(schema.keywordRankings)
    .where(and(eq(schema.keywordRankings.projectId, projectId), eq(schema.keywordRankings.checkedOn, date)));
  const [trackedRow] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), eq(schema.keywords.isTracked, true)));
  const tracked = Number(trackedRow?.n ?? 0);
  const ranked = rows.filter((r) => r.position !== null);
  const avg = ranked.length ? ranked.reduce((a, r) => a + (r.position as number), 0) / ranked.length : null;
  // Volume-weighted estimates only when metrics exist for the keyword.
  const ids = rows.map((r) => r.keywordId);
  let est: number | null = null;
  let vis: number | null = null;
  if (ids.length) {
    const metrics = await tx.select({ keywordId: schema.keywordMetrics.keywordId, searchVolume: schema.keywordMetrics.searchVolume, fetchedAt: schema.keywordMetrics.fetchedAt }).from(schema.keywordMetrics).where(inArray(schema.keywordMetrics.keywordId, ids)).orderBy(desc(schema.keywordMetrics.fetchedAt));
    const vol = new Map<string, number>();
    for (const m of metrics) if (m.keywordId && m.searchVolume !== null && !vol.has(m.keywordId)) vol.set(m.keywordId, m.searchVolume);
    if (vol.size) {
      let traffic = 0, weight = 0, maxWeight = 0;
      for (const r of rows) {
        const v = vol.get(r.keywordId);
        if (v === undefined) continue;
        traffic += ctrFor(r.position) * v;
        weight += ctrFor(r.position) * v;
        maxWeight += ctrFor(1) * v;
      }
      est = Math.round(traffic);
      vis = maxWeight ? Math.round((weight / maxWeight) * 1000) / 10 : null;
    }
  }
  return { date, tracked, ranked: ranked.length, top3: ranked.filter((r) => (r.position as number) <= 3).length, top10: ranked.filter((r) => (r.position as number) <= 10).length, top100: ranked.filter((r) => (r.position as number) <= 100).length, avgPosition: avg === null ? null : Math.round(avg * 10) / 10, estimatedTraffic: est, visibilityIndex: vis };
}

/** Keywords where ≥2 project URLs rank in the same SERP — cannibalisation candidates (evidence from competingUrls). */
export async function cannibalizationCandidates(tx: Transaction, projectId: string, date: string) {
  const rows = await tx
    .select({ keywordId: schema.keywordRankings.keywordId, position: schema.keywordRankings.position, url: schema.keywordRankings.url, competingUrls: schema.keywordRankings.competingUrls, keyword: schema.keywords.keyword })
    .from(schema.keywordRankings)
    .innerJoin(schema.keywords, eq(schema.keywords.id, schema.keywordRankings.keywordId))
    .where(and(eq(schema.keywordRankings.projectId, projectId), eq(schema.keywordRankings.checkedOn, date)));
  return rows.filter((r) => r.competingUrls.length > 0).map((r) => ({ keywordId: r.keywordId, keyword: r.keyword, urls: [{ url: r.url ?? "", position: r.position ?? 0 }, ...r.competingUrls] }));
}

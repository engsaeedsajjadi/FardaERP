import { and, desc, eq, schema, type Transaction } from "@seopilot/db";
import { locationByIso, type CompetitorProvider } from "@seopilot/providers";
import { AppError, normalizeDomain } from "@seopilot/shared";
import { assertCountLimit, consumeCredits, recordUsage } from "@seopilot/usage";

export async function addCompetitor(tx: Transaction, input: { projectId: string; organizationId: string; domain: string; name?: string | null; source?: "manual" | "discovered"; discoveredVia?: string | null }): Promise<string> {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new AppError("VALIDATION_ERROR", "Invalid competitor domain");
  await assertCountLimit(tx, input.organizationId, "competitorsPerProject", { projectId: input.projectId });
  const [row] = await tx
    .insert(schema.competitors)
    .values({ projectId: input.projectId, organizationId: input.organizationId, domain, name: input.name ?? null, source: input.source ?? "manual", discoveredVia: input.discoveredVia ?? null })
    .onConflictDoUpdate({ target: [schema.competitors.projectId, schema.competitors.domain], set: { isActive: true, updatedAt: new Date() } })
    .returning({ id: schema.competitors.id });
  return row!.id;
}

/** Snapshot a competitor (or the project's own domain) — worker COMPETITOR_CHECK job. */
export async function snapshotDomain(tx: Transaction, provider: CompetitorProvider, input: { projectId: string; organizationId: string; competitorId: string | null; domain: string; country: string; language: string; jobId: string; rankedKeywordLimit?: number }): Promise<{ snapshotId: string; costUsd: number | null }> {
  const code = locationByIso(input.country)?.code;
  if (!code) throw new AppError("VALIDATION_ERROR", `Unsupported country ${input.country}`);
  const market = { locationCode: code, languageCode: input.language };
  await consumeCredits(tx, { organizationId: input.organizationId, projectId: input.projectId, operation: "competitor.overview", provider: provider.name, referenceType: "job", referenceId: input.jobId, idempotencyKey: `comp-overview:${input.jobId}:${input.domain}` });
  const overview = await provider.domainOverview(input.domain, market);
  let costUsd = overview.cost.costUsd;
  let ranked: Awaited<ReturnType<CompetitorProvider["rankedKeywords"]>> | null = null;
  if (input.rankedKeywordLimit && input.rankedKeywordLimit > 0) {
    await consumeCredits(tx, { organizationId: input.organizationId, projectId: input.projectId, operation: "competitor.ranked_keywords", provider: provider.name, referenceType: "job", referenceId: input.jobId, idempotencyKey: `comp-ranked:${input.jobId}:${input.domain}` });
    ranked = await provider.rankedKeywords(input.domain, market, input.rankedKeywordLimit);
    if (ranked.cost.costUsd !== null) costUsd = (costUsd ?? 0) + ranked.cost.costUsd;
  }
  const topPages = ranked ? aggregateTopPages(ranked.data) : null;
  const [snap] = await tx
    .insert(schema.competitorSnapshots)
    .values({
      competitorId: input.competitorId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      domain: input.domain,
      country: input.country,
      language: input.language,
      organicKeywords: overview.data?.organicKeywords ?? null,
      organicTraffic: overview.data?.organicTraffic ?? null,
      organicTrafficCost: overview.data?.organicTrafficCost ?? null,
      topPages,
      rankedKeywords: ranked ? ranked.data.map((r) => ({ keyword: r.keyword, position: r.position ?? 0, url: r.url, volume: r.searchVolume })) : null,
      referringDomains: null,
      backlinks: null,
      domainRank: null,
      provider: overview.provider,
      providerRequestId: overview.cost.requestId,
    })
    .returning({ id: schema.competitorSnapshots.id });
  await recordUsage(tx, { organizationId: input.organizationId, projectId: input.projectId, metric: "keyword_calls", quantity: ranked ? 2 : 1, provider: provider.name });
  return { snapshotId: snap!.id, costUsd };
}

export function aggregateTopPages(rows: Array<{ url: string | null; etv: number | null }>): Array<{ url: string; keywords: number; traffic: number | null }> {
  const m = new Map<string, { keywords: number; traffic: number | null }>();
  for (const r of rows) {
    if (!r.url) continue;
    const cur = m.get(r.url) ?? { keywords: 0, traffic: null };
    cur.keywords++;
    if (r.etv !== null) cur.traffic = (cur.traffic ?? 0) + r.etv;
    m.set(r.url, cur);
  }
  return [...m.entries()].map(([url, v]) => ({ url, ...v })).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0) || b.keywords - a.keywords).slice(0, 50);
}

export interface GapRow {
  keyword: string;
  volume: number | null;
  competitors: Array<{ domain: string; position: number; url: string | null }>;
  ownPosition: number | null;
}

/** Keyword gap: keywords competitors rank for (from their latest snapshots) that the project does not rank for (latest own snapshot / tracked rankings). */
export async function keywordGap(tx: Transaction, projectId: string, ownDomain: string, minCompetitors = 1): Promise<GapRow[]> {
  const snaps = await tx.select().from(schema.competitorSnapshots).where(eq(schema.competitorSnapshots.projectId, projectId)).orderBy(desc(schema.competitorSnapshots.fetchedAt));
  const latest = new Map<string, typeof snaps[number]>();
  for (const s of snaps) if (!latest.has(s.domain)) latest.set(s.domain, s);
  const own = latest.get(normalizeDomain(ownDomain));
  const ownMap = new Map((own?.rankedKeywords ?? []).map((r) => [r.keyword, r.position]));
  const gap = new Map<string, GapRow>();
  for (const [domain, s] of latest) {
    if (domain === normalizeDomain(ownDomain)) continue;
    for (const r of s.rankedKeywords ?? []) {
      const ownPos = ownMap.get(r.keyword) ?? null;
      if (ownPos !== null && ownPos <= 20) continue;
      const g = gap.get(r.keyword) ?? { keyword: r.keyword, volume: r.volume ?? null, competitors: [], ownPosition: ownPos };
      g.competitors.push({ domain, position: r.position, url: r.url });
      gap.set(r.keyword, g);
    }
  }
  return [...gap.values()].filter((g) => g.competitors.length >= minCompetitors).sort((a, b) => b.competitors.length - a.competitors.length || (b.volume ?? 0) - (a.volume ?? 0));
}

export async function latestSnapshots(tx: Transaction, projectId: string) {
  const snaps = await tx.select().from(schema.competitorSnapshots).where(and(eq(schema.competitorSnapshots.projectId, projectId))).orderBy(desc(schema.competitorSnapshots.fetchedAt));
  const latest = new Map<string, typeof snaps[number]>();
  for (const s of snaps) if (!latest.has(s.domain)) latest.set(s.domain, s);
  return [...latest.values()];
}

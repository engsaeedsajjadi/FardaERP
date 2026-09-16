/**
 * Keyword / ranking / competitor / backlink services against real Postgres +
 * RLS, using in-memory provider fakes (no network). Verifies persistence,
 * metering, idempotency and that nothing is fabricated when providers return
 * nothing.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { BacklinkProvider, CompetitorProvider, KeywordDataProvider, SerpProvider, SerpSnapshot } from "../../packages/providers/src";
import { addKeywords, refreshKeywordMetrics, runKeywordResearch, latestMetricsForKeywords, keywordCounts } from "../../packages/keywords/src";
import { createRankCheckRun, checkKeywordRank, finishRankCheckRun, visibilityForDate, cannibalizationCandidates } from "../../packages/rankings/src";
import { addCompetitor, snapshotDomain, keywordGap } from "../../packages/competitors/src";
import { refreshBacklinks, latestBacklinkSnapshot, anchorDistribution } from "../../packages/backlinks/src";
import { grantCredits, getBalance, listTransactions } from "../../packages/usage/src";
import { createOrgForUser, createProject, createUser, withTenant, withSystem, schema } from "./helpers";
import { eq } from "../../packages/db/src";

let userId: string, orgId: string, projectId: string;
const jobId = () => `job-${Math.random().toString(36).slice(2)}`;

const call = <T,>(data: T, cost = 0.01) => ({ data, provider: "fake", cost: { costUsd: cost, requestId: "req-1", endpoint: "/fake" }, fetchedAt: new Date() });

const keywordProvider: KeywordDataProvider = {
  name: "fake",
  keywordMetrics: async (kws) => call(kws.map((k) => (k === "seo tools" ? { keyword: k, searchVolume: 5400, cpc: 3.2, competition: 0.6, competitionLevel: "HIGH", keywordDifficulty: 61, intent: "commercial", monthlySearches: [], serpFeatures: ["organic", "people_also_ask"] } : { keyword: k, searchVolume: null, cpc: null, competition: null, competitionLevel: null, keywordDifficulty: null, intent: null, monthlySearches: [], serpFeatures: null }))),
  relatedKeywords: async () => call([{ keyword: "seo audit tool", searchVolume: 900, cpc: null, competition: null, competitionLevel: null, keywordDifficulty: 30, intent: null, monthlySearches: [], serpFeatures: null, source: "related" as const }]),
  keywordSuggestions: async () => call([]),
  keywordIdeas: async () => call([]),
  keywordsForSite: async () => call([]),
};

let serpItems: SerpSnapshot["items"] = [];
const serpProvider: SerpProvider = { name: "fake", liveSerp: async (q) => call({ query: q, checkUrl: null, resultCount: 100, items: serpItems, serpFeatures: ["organic", "featured_snippet"] }, 0.002) };

const competitorProvider: CompetitorProvider = {
  name: "fake",
  domainOverview: async (d) => call(d === "rival.example" ? { domain: d, organicKeywords: 1200, organicTraffic: 8000, organicTrafficCost: null, positions: null } : null),
  rankedKeywords: async (d) => call(d === "rival.example" ? [{ keyword: "seo tools", position: 4, url: "https://rival.example/tools", searchVolume: 5400, cpc: null, keywordDifficulty: 61, etv: 400 }, { keyword: "technical seo checklist", position: 2, url: "https://rival.example/checklist", searchVolume: 700, cpc: null, keywordDifficulty: 20, etv: 100 }] : [{ keyword: "seo tools", position: 9, url: "https://own.example/x", searchVolume: 5400, cpc: null, keywordDifficulty: 61, etv: 50 }]),
  serpCompetitors: async () => call([]),
};

let backlinkRows = [
  { sourceUrl: "https://a.example/post", sourceDomain: "a.example", targetUrl: "https://own.example/", anchor: "Own Brand", isDofollow: true, linkType: "anchor", domainRank: 300, pageRank: 100, firstSeen: "2025-01-01 00:00:00 +00:00", lastSeen: null, isLost: false, spamScore: 5 },
  { sourceUrl: "https://b.example/", sourceDomain: "b.example", targetUrl: "https://own.example/", anchor: "seo tools", isDofollow: false, linkType: "anchor", domainRank: 100, pageRank: 20, firstSeen: null, lastSeen: null, isLost: false, spamScore: 0 },
];
const backlinkProvider: BacklinkProvider = {
  name: "fake",
  summary: async (t) => call({ target: t, backlinks: 2, referringDomains: 2, referringIps: 2, dofollow: 1, nofollow: 1, domainRank: 250, brokenBacklinks: 0, referringDomainsNofollow: 1 }),
  backlinks: async () => call(backlinkRows),
  anchors: async () => call([{ anchor: "Own Brand", backlinks: 1, referringDomains: 1 }, { anchor: "seo tools", backlinks: 1, referringDomains: 1 }]),
  referringDomains: async () => call([]),
};

beforeAll(async () => {
  ({ id: userId } = await createUser());
  orgId = await createOrgForUser(userId, "Seo");
  projectId = await createProject(userId, orgId, "own.example");
  await withSystem(orgId, (tx) => tx.update(schema.organizations).set({ planCode: "pro" }).where(eq(schema.organizations.id, orgId)));
  await withTenant({ userId }, async (tx) => {
    await tx.insert(schema.creditWallets).values({ organizationId: orgId, balance: 0 });
    await grantCredits(tx, { organizationId: orgId, amount: 500 });
  });
});

describe("keywords", () => {
  let ids: string[] = [];
  it("adds deduped keywords with heuristic intent and question tags", async () => {
    await withTenant({ userId }, async (tx) => {
      const r = await addKeywords(tx, { projectId, keywords: ["SEO Tools", "seo tools ", "what is technical seo", "buy seo software"], userId });
      expect(r).toMatchObject({ added: 3, skipped: 1 });
      ids = r.ids;
      const rows = await tx.select().from(schema.keywords).where(eq(schema.keywords.projectId, projectId));
      const byKw = Object.fromEntries(rows.map((k) => [k.normalizedKeyword, k]));
      expect(byKw["what is technical seo"]).toMatchObject({ intent: "informational", intentSource: "heuristic", tags: ["question"] });
      expect(byKw["buy seo software"]?.intent).toBe("transactional");
      const again = await addKeywords(tx, { projectId, keywords: ["seo tools"], userId });
      expect(again).toMatchObject({ added: 0, skipped: 1 });
      expect(await keywordCounts(tx, projectId)).toEqual({ total: 3, tracked: 3, questions: 1 });
    });
  });

  it("refreshes metrics: stores provider rows, nulls for unknown keywords, upgrades intent to provider, charges once per job", async () => {
    const job = jobId();
    await withTenant({ userId }, async (tx) => {
      const before = (await getBalance(tx, orgId)).balance;
      const r = await refreshKeywordMetrics(tx, keywordProvider, { projectId, jobId: job });
      expect(r.refreshed).toBe(3);
      expect((await getBalance(tx, orgId)).balance).toBe(before - 1); // 3 keywords → ceil(3/10) = 1 credit
      const metrics = await latestMetricsForKeywords(tx, ids);
      const seoTools = [...metrics.values()].find((m) => m.keyword === "seo tools");
      expect(seoTools).toMatchObject({ searchVolume: 5400, keywordDifficulty: 61, provider: "fake", providerRequestId: "req-1" });
      const q = [...metrics.values()].find((m) => m.keyword === "what is technical seo");
      expect(q?.searchVolume).toBeNull();
      const [kw] = await tx.select().from(schema.keywords).where(eq(schema.keywords.normalizedKeyword, "seo tools"));
      expect(kw).toMatchObject({ intent: "commercial", intentSource: "provider" });
      // retry same job → idempotent charge
      await refreshKeywordMetrics(tx, keywordProvider, { projectId, jobId: job });
      expect((await getBalance(tx, orgId)).balance).toBe(before - 1);
    });
  });

  it("persists research runs", async () => {
    await withTenant({ userId }, async (tx) => {
      const r = await runKeywordResearch(tx, keywordProvider, { projectId, kind: "related", seed: "seo", userId, jobId: jobId() });
      expect(r.results[0]).toMatchObject({ keyword: "seo audit tool", intent: "commercial" });
      const [run] = await tx.select().from(schema.keywordResearchRuns).where(eq(schema.keywordResearchRuns.id, r.runId));
      expect(run).toMatchObject({ kind: "related", resultCount: 1, provider: "fake", costCredits: 5 });
    });
  });
});

describe("rankings", () => {
  it("records positions from SERP snapshots, previous position, competing URLs and visibility", async () => {
    const day1 = "2026-09-15", day2 = "2026-09-16";
    const kwIds = await withTenant({ userId }, async (tx) => (await tx.select({ id: schema.keywords.id }).from(schema.keywords).where(eq(schema.keywords.projectId, projectId))).map((k) => k.id));
    serpItems = [
      { type: "organic", rank: 1, rankAbsolute: 1, domain: "rival.example", url: "https://rival.example/", title: null, description: null },
      { type: "organic", rank: 5, rankAbsolute: 6, domain: "own.example", url: "https://own.example/a", title: null, description: null },
      { type: "organic", rank: 8, rankAbsolute: 9, domain: "www.own.example", url: "https://www.own.example/b", title: null, description: null },
    ];
    const job1 = jobId();
    const runId = await withTenant({ userId }, (tx) => createRankCheckRun(tx, { projectId, organizationId: orgId, jobId: null, keywordCount: kwIds.length, provider: "fake", triggeredBy: "test" }));
    for (const id of kwIds) await withTenant({ userId }, (tx) => checkKeywordRank(tx, serpProvider, { runId, keywordId: id, projectDomain: "own.example", jobId: job1, checkedOn: day1 }));
    serpItems = [{ type: "organic", rank: 2, rankAbsolute: 2, domain: "own.example", url: "https://own.example/a", title: null, description: null }];
    const job2 = jobId();
    const change = await withTenant({ userId }, (tx) => checkKeywordRank(tx, serpProvider, { runId, keywordId: kwIds[0] as string, projectDomain: "own.example", jobId: job2, checkedOn: day2 }));
    expect(change).toMatchObject({ previousPosition: 5, position: 2, delta: 3, url: "https://own.example/a" });
    await withTenant({ userId }, async (tx) => {
      await finishRankCheckRun(tx, runId, { checked: kwIds.length + 1, failed: 0, costCredits: kwIds.length + 1 });
      const [run] = await tx.select().from(schema.rankCheckRuns).where(eq(schema.rankCheckRuns.id, runId));
      expect(run?.status).toBe("completed");
      const v1 = await visibilityForDate(tx, projectId, day1);
      expect(v1).toMatchObject({ tracked: 3, ranked: 3, top3: 0, top10: 3, avgPosition: 5 });
      expect(v1.estimatedTraffic).toBe(Math.round(0.058 * 5400)); // only "seo tools" has volume
      const v2 = await visibilityForDate(tx, projectId, day2);
      expect(v2).toMatchObject({ ranked: 1, top3: 1 });
      const cann = await cannibalizationCandidates(tx, projectId, day1);
      expect(cann).toHaveLength(3);
      expect(cann[0]?.urls).toEqual([{ url: "https://own.example/a", position: 5 }, { url: "https://www.own.example/b", position: 8 }]);
      const txs = await listTransactions(tx, orgId);
      expect(txs.filter((t) => t.operation === "serp.check")).toHaveLength(kwIds.length + 1);
      const [serp] = await tx.select().from(schema.serpResults).where(eq(schema.serpResults.projectId, projectId)).limit(1);
      expect(serp?.items.length).toBeGreaterThan(0);
    });
  });
  it("records 'not ranked' as null position — never a fabricated number", async () => {
    serpItems = [];
    const kw = await withTenant({ userId }, async (tx) => (await tx.select({ id: schema.keywords.id }).from(schema.keywords).where(eq(schema.keywords.projectId, projectId)))[0]!.id);
    const runId = await withTenant({ userId }, (tx) => createRankCheckRun(tx, { projectId, organizationId: orgId, jobId: null, keywordCount: 1, provider: "fake", triggeredBy: "test" }));
    const c = await withTenant({ userId }, (tx) => checkKeywordRank(tx, serpProvider, { runId, keywordId: kw, projectDomain: "own.example", jobId: jobId(), checkedOn: "2026-09-17" }));
    expect(c.position).toBeNull();
    expect(c.delta).toBeNull();
  });
});

describe("competitors + backlinks", () => {
  it("snapshots competitors and computes the keyword gap from real snapshot data", async () => {
    await withTenant({ userId }, async (tx) => {
      const compId = await addCompetitor(tx, { projectId, organizationId: orgId, domain: "https://www.rival.example/", source: "manual" });
      expect(compId).toBeTruthy();
      const job = jobId();
      await snapshotDomain(tx, competitorProvider, { projectId, organizationId: orgId, competitorId: compId, domain: "rival.example", country: "US", language: "en", jobId: job, rankedKeywordLimit: 100 });
      await snapshotDomain(tx, competitorProvider, { projectId, organizationId: orgId, competitorId: null, domain: "own.example", country: "US", language: "en", jobId: job, rankedKeywordLimit: 100 });
      const gap = await keywordGap(tx, projectId, "own.example");
      expect(gap.map((g) => g.keyword)).toEqual(["technical seo checklist"]); // "seo tools": own ranks #9 → not a gap
      expect(gap[0]?.competitors).toEqual([{ domain: "rival.example", position: 2, url: "https://rival.example/checklist" }]);
      const [snap] = await tx.select().from(schema.competitorSnapshots).where(eq(schema.competitorSnapshots.domain, "rival.example"));
      expect(snap).toMatchObject({ organicKeywords: 1200, organicTraffic: 8000 });
      expect(snap?.topPages?.[0]).toMatchObject({ url: "https://rival.example/tools", keywords: 1, traffic: 400 });
      const [ownSnap] = await tx.select().from(schema.competitorSnapshots).where(eq(schema.competitorSnapshots.domain, "own.example"));
      expect(ownSnap?.organicKeywords).toBeNull(); // provider returned null overview → stays null
    });
  });

  it("refreshes backlinks with new/lost detection and anchor analysis", async () => {
    await withTenant({ userId }, async (tx) => {
      const r1 = await refreshBacklinks(tx, backlinkProvider, { projectId, organizationId: orgId, target: "own.example", jobId: jobId(), limit: 1000 });
      expect(r1).toMatchObject({ newLinks: 2, lostLinks: 0 });
      backlinkRows = [backlinkRows[0]!];
      const r2 = await refreshBacklinks(tx, backlinkProvider, { projectId, organizationId: orgId, target: "own.example", jobId: jobId(), limit: 1000 });
      expect(r2).toMatchObject({ newLinks: 0, lostLinks: 1 });
      const rows = await tx.select().from(schema.backlinks).where(eq(schema.backlinks.projectId, projectId));
      expect(rows.find((b) => b.sourceDomain === "b.example")?.isLost).toBe(true);
      const snap = await latestBacklinkSnapshot(tx, projectId, "own.example");
      expect(snap).toMatchObject({ backlinks: 2, referringDomains: 2, domainRank: 250, lostLast30: 1 });
      const dist = anchorDistribution(snap!.anchors ?? [], ["Own Brand"]);
      expect(dist.rows.map((r) => r.kind)).toEqual(["brand", "exact"]);
      expect(dist.overOptimized).toEqual(["seo tools"]); // 50% exact-match
    });
  });
});

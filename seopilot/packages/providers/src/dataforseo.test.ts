import { describe, expect, it } from "vitest";
import { AppError } from "@seopilot/shared";
import { DataForSeoClient, assertTask, type FetchLike } from "./dataforseo/client";
import { DataForSeoKeywordProvider } from "./dataforseo/keywords";
import { DataForSeoSerpProvider, findDomainRank } from "./dataforseo/serp";
import { DataForSeoBacklinkProvider } from "./dataforseo/backlinks";
import { DataForSeoCompetitorProvider } from "./dataforseo/competitors";
import { buildProviders, providerStatus, requireProvider } from "./registry";
import { keywordDataLanguage, languagesForLocation, locationByIso } from "./locations";

type Call = { url: string; body: unknown; headers: Record<string, string> };

function fakeFetch(responder: (call: Call, attempt: number) => { status: number; body: unknown }): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, body: JSON.parse(init.body ?? "null"), headers: init.headers };
    calls.push(call);
    const r = responder(call, calls.length);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) };
  };
  return { fetch, calls };
}

const okEnvelope = (path: string[], result: unknown[], cost = 0.01) => ({ status_code: 20000, status_message: "Ok.", tasks: [{ id: "task-1", status_code: 20000, status_message: "Ok.", cost, path, result }] });

describe("DataForSeoClient", () => {
  it("sends Basic auth and returns task + provider cost", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: okEnvelope(["v3", "x"], [{ items: [] }], 0.002) }));
    const c = new DataForSeoClient({ login: "u", password: "p" }, fetch);
    const { task, cost } = await c.postTask("/v3/x", { a: 1 });
    expect(calls[0]?.headers["authorization"]).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
    expect(calls[0]?.body).toEqual([{ a: 1 }]);
    expect(task.status_code).toBe(20000);
    expect(cost).toEqual({ costUsd: 0.002, requestId: "task-1", endpoint: "/v3/x" });
  });
  it("retries transient 5xx then succeeds; does not retry 4xx", async () => {
    const { fetch, calls } = fakeFetch((_c, n) => (n < 3 ? { status: 503, body: "down" } : { status: 200, body: okEnvelope(["v3"], []) }));
    const c = new DataForSeoClient({ login: "u", password: "p" }, fetch);
    await c.postTask("/v3/x", {});
    expect(calls).toHaveLength(3);
    const bad = new DataForSeoClient({ login: "u", password: "p" }, fakeFetch(() => ({ status: 400, body: "bad" })).fetch);
    await expect(bad.postTask("/v3/x", {})).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("maps HTTP auth/balance/rate-limit to non-reportable app errors", async () => {
    for (const [status, code] of [[401, "PROVIDER_AUTH_FAILED"], [402, "PROVIDER_ERROR"], [429, "RATE_LIMITED"]] as const) {
      const c = new DataForSeoClient({ login: "u", password: "p" }, fakeFetch(() => ({ status, body: "" })).fetch);
      const err = await c.postTask("/v3/x", {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(code);
      expect((err as AppError).reportable).toBe(false);
    }
  });
  it("assertTask: no-results is empty success, backend codes are UPSTREAM, invalid field is VALIDATION with sent value, access codes are AUTH", () => {
    const mk = (status_code: number, status_message: string, data?: Record<string, unknown>) => ({ status_code: 20000, tasks: [{ id: "t", status_code, status_message, cost: 0.01, data }] });
    expect(assertTask(mk(40501, "No Search Results."), "/p").result).toEqual([]);
    expect(() => assertTask(mk(40501, "No Search Results."), "/p", { treatNoResultsAsEmpty: false })).toThrow();
    expect(() => assertTask(mk(50000, "Internal Error."), "/p")).toThrow(expect.objectContaining({ code: "UPSTREAM_UNAVAILABLE" }));
    expect(() => assertTask(mk(40501, "Invalid Field: 'target'.", { target: "??" }), "/p")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR", message: expect.stringContaining('sent target="??"') }));
    expect(() => assertTask(mk(40200, "Payment Required."), "/p")).toThrow(expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }));
    expect(() => assertTask({ status_code: 40100, status_message: "Unauthorized." }, "/p")).toThrow(expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }));
    expect(() => assertTask(null, "/p")).toThrow(expect.objectContaining({ code: "PROVIDER_ERROR" }));
  });
});

describe("keyword provider", () => {
  const labsItem = (keyword: string, vol: number | null) => ({ keyword, keyword_info: { search_volume: vol, cpc: 1.5, competition: 0.3, competition_level: "LOW", monthly_searches: [{ year: 2026, month: 8, search_volume: 100 }] }, keyword_properties: { keyword_difficulty: 42 }, search_intent_info: { main_intent: "informational" }, serp_info: { serp_item_types: ["organic", "people_also_ask"] } });
  it("keywordMetrics via Labs: normalises, dedupes, and returns explicit nulls for missing keywords", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: okEnvelope(["v3", "dataforseo_labs", "google", "keyword_overview", "live"], [{ items: [labsItem("seo tools", 5400)] }], 0.0101) }));
    const p = new DataForSeoKeywordProvider(new DataForSeoClient({ login: "u", password: "p" }, fetch));
    const r = await p.keywordMetrics(["SEO Tools", "seo tools", "unknown kw"], { locationCode: 2840, languageCode: "en" });
    expect(calls[0]?.url).toContain("/v3/dataforseo_labs/google/keyword_overview/live");
    expect((calls[0]?.body as Array<Record<string, unknown>>)[0]?.["keywords"]).toEqual(["seo tools", "unknown kw"]);
    expect(r.data).toHaveLength(2);
    expect(r.data[0]).toMatchObject({ keyword: "seo tools", searchVolume: 5400, keywordDifficulty: 42, intent: "informational", serpFeatures: ["organic", "people_also_ask"], monthlySearches: [{ year: 2026, month: 8, volume: 100 }] });
    expect(r.data[1]).toMatchObject({ keyword: "unknown kw", searchVolume: null, cpc: null, keywordDifficulty: null });
    expect(r.cost.costUsd).toBe(0.0101);
  });
  it("falls back to Google Ads endpoints for Labs-unsupported markets and never invents KD/intent", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: okEnvelope(["v3", "keywords_data", "google_ads", "search_volume", "live"], [{ keyword: "hotel fiji", search_volume: 880, cpc: 0.8, competition: "MEDIUM", competition_index: 45, monthly_searches: [] }]) }));
    const p = new DataForSeoKeywordProvider(new DataForSeoClient({ login: "u", password: "p" }, fetch));
    const fiji = locationByIso("FJ")!;
    const r = await p.keywordMetrics(["hotel fiji"], { locationCode: fiji.code, languageCode: "en" });
    expect(calls[0]?.url).toContain("/v3/keywords_data/google_ads/search_volume/live");
    expect(r.data[0]).toMatchObject({ searchVolume: 880, competition: 0.45, keywordDifficulty: null, intent: null });
  });
  it("relatedKeywords tags source and coerces language to a supported one", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: okEnvelope(["v3"], [{ items: [{ keyword_data: labsItem("seo audit", 1000) }] }]) }));
    const p = new DataForSeoKeywordProvider(new DataForSeoClient({ login: "u", password: "p" }, fetch));
    const r = await p.relatedKeywords("seo", { locationCode: 2250, languageCode: "de" }, 50);
    expect((calls[0]?.body as Array<Record<string, unknown>>)[0]?.["language_code"]).toBe("fr");
    expect(r.data[0]).toMatchObject({ keyword: "seo audit", source: "related", searchVolume: 1000 });
  });
});

describe("serp provider", () => {
  it("normalises organic items and finds domain rank using rank_group", async () => {
    const items = [
      { type: "featured_snippet", rank_group: 1, rank_absolute: 1, domain: "other.com", url: "https://other.com/a" },
      { type: "organic", rank_group: 1, rank_absolute: 2, domain: "other.com", url: "https://other.com/a", title: "A", description: "d" },
      { type: "organic", rank_group: 2, rank_absolute: 3, domain: "www.example.com", url: "https://www.example.com/x", title: "X" },
      { type: "organic", rank_group: 7, rank_absolute: 9, domain: "blog.example.com", url: "https://blog.example.com/y" },
    ];
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: okEnvelope(["v3"], [{ check_url: "https://google.com/search?q=x", se_results_count: 12345, item_types: ["featured_snippet", "organic"], items }], 0.002) }));
    const p = new DataForSeoSerpProvider(new DataForSeoClient({ login: "u", password: "p" }, fetch));
    const r = await p.liveSerp("x", { locationCode: 2840, languageCode: "en", device: "mobile" });
    expect((calls[0]?.body as Array<Record<string, unknown>>)[0]).toMatchObject({ device: "mobile", os: "android", depth: 100 });
    expect(r.data.serpFeatures).toEqual(["featured_snippet", "organic"]);
    expect(r.data.resultCount).toBe(12345);
    const rank = findDomainRank(r.data, "example.com");
    expect(rank).toEqual({ position: 2, url: "https://www.example.com/x", competing: [{ url: "https://blog.example.com/y", position: 7 }] });
    expect(findDomainRank(r.data, "nowhere.com").position).toBeNull();
  });
  it("returns an empty snapshot for a billed 'No Search Results' task", async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, body: { status_code: 20000, tasks: [{ id: "t", status_code: 40501, status_message: "No Search Results.", cost: 0.002, path: ["v3"] }] } }));
    const p = new DataForSeoSerpProvider(new DataForSeoClient({ login: "u", password: "p" }, fetch));
    const r = await p.liveSerp("zzzz", { locationCode: 2840, languageCode: "en", device: "desktop" });
    expect(r.data.items).toEqual([]);
    expect(r.cost.costUsd).toBe(0.002);
  });
});

describe("backlink + competitor providers", () => {
  it("summary normalises DataForSEO fields and derives dofollow only when both parts are present", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: okEnvelope(["v3"], [{ backlinks: 100, referring_domains: 40, referring_ips: 35, rank: 312, broken_backlinks: 3, referring_links_attributes: { nofollow: 20 } }]) }));
    const p = new DataForSeoBacklinkProvider(new DataForSeoClient({ login: "u", password: "p" }, fetch));
    const r = await p.summary("www.example.com");
    expect((calls[0]?.body as Array<Record<string, unknown>>)[0]).toMatchObject({ target: "example.com", include_subdomains: true });
    expect(r.data).toMatchObject({ backlinks: 100, referringDomains: 40, domainRank: 312, nofollow: 20, dofollow: 80, brokenBacklinks: 3 });
  });
  it("backlinks rows skip malformed items", async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, body: okEnvelope(["v3"], [{ items: [{ url_from: "https://a.com/p", url_to: "https://example.com/", domain_from: "a.com", anchor: "x", dofollow: false, domain_from_rank: 200, first_seen: "2025-01-01 00:00:00 +00:00", is_lost: false }, { url_from: null }] }]) }));
    const p = new DataForSeoBacklinkProvider(new DataForSeoClient({ login: "u", password: "p" }, fetch));
    const r = await p.backlinks("example.com", 10);
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ sourceDomain: "a.com", isDofollow: false, domainRank: 200 });
  });
  it("domainOverview returns null when the provider has no metrics (never zeros)", async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, body: okEnvelope(["v3"], [{ items: [] }]) }));
    const p = new DataForSeoCompetitorProvider(new DataForSeoClient({ login: "u", password: "p" }, fetch));
    expect((await p.domainOverview("example.com", { locationCode: 2840, languageCode: "en" })).data).toBeNull();
    const { fetch: f2 } = fakeFetch(() => ({ status: 200, body: okEnvelope(["v3"], [{ items: [{ metrics: { organic: { count: 120, etv: 3400.5, pos_1: 2, pos_2_3: 5, pos_4_10: 20 } } }] }]) }));
    const p2 = new DataForSeoCompetitorProvider(new DataForSeoClient({ login: "u", password: "p" }, f2));
    expect((await p2.domainOverview("example.com", { locationCode: 2840, languageCode: "en" })).data).toMatchObject({ organicKeywords: 120, organicTraffic: 3400.5, positions: { "1-3": 7, "4-10": 20 } });
  });
});

describe("registry + locations", () => {
  it("reports not configured without credentials and throws PROVIDER_NOT_CONFIGURED (424)", () => {
    const set = buildProviders({});
    expect(set.keywords).toBeNull();
    const s = providerStatus("serp", set);
    expect(s.configured).toBe(false);
    expect(s.reason).toMatch(/DATAFORSEO_LOGIN/);
    const err = (() => { try { requireProvider("serp", set); } catch (e) { return e as AppError; } return null; })();
    expect(err?.code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(err?.status).toBe(424);
    expect(err?.reportable).toBe(false);
  });
  it("builds DataForSEO providers when credentials exist", () => {
    const set = buildProviders({ DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b" });
    expect(set.keywords?.name).toBe("dataforseo");
    expect(providerStatus("backlinks", set).configured).toBe(true);
  });
  it("location helpers", () => {
    expect(locationByIso("us")?.code).toBe(2840);
    expect(languagesForLocation(2756)).toEqual(["de", "fr", "it"]);
    expect(keywordDataLanguage(2756, "it")).toBe("it");
    expect(keywordDataLanguage(2250, "en")).toBe("fr");
    expect(locationByIso("FJ")?.labsSupported).toBe(false);
  });
});

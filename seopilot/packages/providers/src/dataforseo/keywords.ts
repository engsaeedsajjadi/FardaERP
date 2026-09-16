import { keywordDataLanguage, locationByCode } from "../locations";
import type { KeywordDataProvider, KeywordIdeaRow, KeywordMetricRow, MarketInput, ProviderCall } from "../types";
import { DataForSeoClient, itemsOf, num, rec, str } from "./client";

const METRICS_BATCH = 700;

function monthly(v: unknown): Array<{ year: number; month: number; volume: number }> {
  if (!Array.isArray(v)) return [];
  return v
    .map((m) => rec(m))
    .filter((m): m is Record<string, unknown> => m !== null)
    .map((m) => ({ year: num(m["year"]) ?? 0, month: num(m["month"]) ?? 0, volume: num(m["search_volume"]) ?? 0 }))
    .filter((m) => m.year > 0);
}

/** Normalise a Labs keyword item (keyword_info / keyword_properties / search_intent_info). */
export function normalizeLabsItem(item: Record<string, unknown>, fallbackKeyword?: string): KeywordMetricRow | null {
  const keyword = str(item["keyword"]) ?? (rec(item["keyword_data"]) ? str(rec(item["keyword_data"])!["keyword"]) : null) ?? fallbackKeyword ?? null;
  if (!keyword) return null;
  const kd = rec(item["keyword_data"]) ?? item;
  const info = rec(kd["keyword_info"]);
  const props = rec(kd["keyword_properties"]);
  const intent = rec(kd["search_intent_info"]);
  const serp = rec(kd["serp_info"]);
  const types = serp && Array.isArray(serp["serp_item_types"]) ? (serp["serp_item_types"] as unknown[]).filter((t): t is string => typeof t === "string") : null;
  return {
    keyword,
    searchVolume: info ? num(info["search_volume"]) : null,
    cpc: info ? num(info["cpc"]) : null,
    competition: info ? num(info["competition"]) : null,
    competitionLevel: info ? str(info["competition_level"]) : null,
    keywordDifficulty: props ? num(props["keyword_difficulty"]) : null,
    intent: intent ? str(intent["main_intent"]) : null,
    monthlySearches: monthly(info?.["monthly_searches"]),
    serpFeatures: types,
  };
}

/** Google Ads search_volume items: volume/CPC/competition only (index 0–100 → ratio). */
export function normalizeAdsItem(item: Record<string, unknown>): KeywordMetricRow | null {
  const keyword = str(item["keyword"]);
  if (!keyword) return null;
  const compIndex = num(item["competition_index"]);
  return {
    keyword,
    searchVolume: num(item["search_volume"]),
    cpc: num(item["cpc"]),
    competition: compIndex !== null ? compIndex / 100 : null,
    competitionLevel: str(item["competition"]),
    keywordDifficulty: null,
    intent: null,
    monthlySearches: monthly(item["monthly_searches"]),
    serpFeatures: null,
  };
}

export class DataForSeoKeywordProvider implements KeywordDataProvider {
  readonly name = "dataforseo";
  constructor(private readonly client: DataForSeoClient) {}

  private market(m: MarketInput) {
    return { location_code: m.locationCode, language_code: keywordDataLanguage(m.locationCode, m.languageCode) };
  }
  private labsSupported(m: MarketInput): boolean {
    return locationByCode(m.locationCode)?.labsSupported !== false;
  }

  async keywordMetrics(keywords: string[], market: MarketInput): Promise<ProviderCall<KeywordMetricRow[]>> {
    const unique = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))];
    const rows: KeywordMetricRow[] = [];
    let costUsd = 0;
    let anyCost = false;
    let requestId: string | null = null;
    let endpoint = "";
    for (let i = 0; i < unique.length; i += METRICS_BATCH) {
      const batch = unique.slice(i, i + METRICS_BATCH);
      if (this.labsSupported(market)) {
        endpoint = "/v3/dataforseo_labs/google/keyword_overview/live";
        const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { keywords: batch, ...this.market(market), include_serp_info: true, include_clickstream_data: false });
        for (const it of itemsOf(task)) {
          const row = normalizeLabsItem(it);
          if (row) rows.push(row);
        }
        if (cost.costUsd !== null) { costUsd += cost.costUsd; anyCost = true; }
        requestId = cost.requestId ?? requestId;
      } else {
        endpoint = "/v3/keywords_data/google_ads/search_volume/live";
        const { task, cost } = await this.client.postTask<Record<string, unknown>>(endpoint, { keywords: batch, ...this.market(market) });
        for (const it of task.result ?? []) {
          const row = normalizeAdsItem(it);
          if (row) rows.push(row);
        }
        if (cost.costUsd !== null) { costUsd += cost.costUsd; anyCost = true; }
        requestId = cost.requestId ?? requestId;
      }
    }
    // Keywords the provider did not return get explicit nulls (never zeros).
    const seen = new Set(rows.map((r) => r.keyword.toLowerCase()));
    for (const k of unique) if (!seen.has(k)) rows.push({ keyword: k, searchVolume: null, cpc: null, competition: null, competitionLevel: null, keywordDifficulty: null, intent: null, monthlySearches: [], serpFeatures: null });
    return { data: rows, provider: this.name, cost: { costUsd: anyCost ? costUsd : null, requestId, endpoint }, fetchedAt: new Date() };
  }

  async relatedKeywords(seed: string, market: MarketInput, limit: number): Promise<ProviderCall<KeywordIdeaRow[]>> {
    if (!this.labsSupported(market)) return this.adsIdeas(seed, market, limit);
    const endpoint = "/v3/dataforseo_labs/google/related_keywords/live";
    const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { keyword: seed, ...this.market(market), limit: Math.min(limit, 1000), depth: 2, include_serp_info: true, include_clickstream_data: false });
    const data = itemsOf(task).map((it) => normalizeLabsItem(it)).filter((r): r is KeywordMetricRow => r !== null).map((r) => ({ ...r, source: "related" as const }));
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }

  async keywordSuggestions(seed: string, market: MarketInput, limit: number): Promise<ProviderCall<KeywordIdeaRow[]>> {
    if (!this.labsSupported(market)) return this.adsIdeas(seed, market, limit);
    const endpoint = "/v3/dataforseo_labs/google/keyword_suggestions/live";
    const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { keyword: seed, ...this.market(market), limit: Math.min(limit, 1000), include_serp_info: true, include_seed_keyword: false, include_clickstream_data: false });
    const data = itemsOf(task).map((it) => normalizeLabsItem(it)).filter((r): r is KeywordMetricRow => r !== null).map((r) => ({ ...r, source: "suggestions" as const }));
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }

  async keywordIdeas(seeds: string[], market: MarketInput, limit: number): Promise<ProviderCall<KeywordIdeaRow[]>> {
    if (!this.labsSupported(market)) return this.adsIdeas(seeds[0] ?? "", market, limit);
    const endpoint = "/v3/dataforseo_labs/google/keyword_ideas/live";
    const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { keywords: seeds.slice(0, 200), ...this.market(market), limit: Math.min(limit, 1000), include_serp_info: true, include_clickstream_data: false });
    const data = itemsOf(task).map((it) => normalizeLabsItem(it)).filter((r): r is KeywordMetricRow => r !== null).map((r) => ({ ...r, source: "ideas" as const }));
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }

  async keywordsForSite(domain: string, market: MarketInput, limit: number): Promise<ProviderCall<KeywordIdeaRow[]>> {
    const endpoint = "/v3/dataforseo_labs/google/ranked_keywords/live";
    const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { target: domain, ...this.market(market), limit: Math.min(limit, 1000), item_types: ["organic"], order_by: ["ranked_serp_element.serp_item.etv,desc"] });
    const data: KeywordIdeaRow[] = [];
    for (const it of itemsOf(task)) {
      const row = normalizeLabsItem(it);
      if (!row) continue;
      const el = rec(rec(it["ranked_serp_element"])?.["serp_item"]);
      data.push({ ...row, source: "ranked", rankedUrl: el ? str(el["url"]) : null, position: el ? num(el["rank_group"]) : null });
    }
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }

  private async adsIdeas(seed: string, market: MarketInput, limit: number): Promise<ProviderCall<KeywordIdeaRow[]>> {
    const endpoint = "/v3/keywords_data/google_ads/keywords_for_keywords/live";
    const { task, cost } = await this.client.postTask<Record<string, unknown>>(endpoint, { keywords: [seed], ...this.market(market), sort_by: "search_volume" });
    const data = (task.result ?? []).map((it) => normalizeAdsItem(it)).filter((r): r is KeywordMetricRow => r !== null).slice(0, limit).map((r) => ({ ...r, source: "ads" as const }));
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }
}

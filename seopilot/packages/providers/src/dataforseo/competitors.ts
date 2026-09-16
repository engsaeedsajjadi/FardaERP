import type { CompetitorProvider, DomainOverview, MarketInput, ProviderCall, RankedKeywordRow } from "../types";
import { DataForSeoClient, itemsOf, num, rec, str } from "./client";

export class DataForSeoCompetitorProvider implements CompetitorProvider {
  readonly name = "dataforseo";
  constructor(private readonly client: DataForSeoClient) {}

  async domainOverview(domain: string, market: MarketInput): Promise<ProviderCall<DomainOverview | null>> {
    const endpoint = "/v3/dataforseo_labs/google/domain_rank_overview/live";
    const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { target: domain, location_code: market.locationCode, language_code: market.languageCode });
    const item = itemsOf(task)[0];
    const organic = item ? rec(rec(item["metrics"])?.["organic"]) : null;
    const data: DomainOverview | null = organic
      ? {
          domain,
          organicKeywords: num(organic["count"]),
          organicTraffic: num(organic["etv"]),
          organicTrafficCost: num(organic["estimated_paid_traffic_cost"]),
          positions: {
            "1-3": (num(organic["pos_1"]) ?? 0) + (num(organic["pos_2_3"]) ?? 0),
            "4-10": num(organic["pos_4_10"]) ?? 0,
            "11-20": num(organic["pos_11_20"]) ?? 0,
            "21-30": num(organic["pos_21_30"]) ?? 0,
            "31-100": ["pos_31_40", "pos_41_50", "pos_51_60", "pos_61_70", "pos_71_80", "pos_81_90", "pos_91_100"].reduce((a, k) => a + (num(organic[k]) ?? 0), 0),
          },
        }
      : null;
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }

  async rankedKeywords(domain: string, market: MarketInput, limit: number): Promise<ProviderCall<RankedKeywordRow[]>> {
    const endpoint = "/v3/dataforseo_labs/google/ranked_keywords/live";
    const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { target: domain, location_code: market.locationCode, language_code: market.languageCode, limit: Math.min(limit, 1000), item_types: ["organic"], order_by: ["ranked_serp_element.serp_item.etv,desc"] });
    const data: RankedKeywordRow[] = [];
    for (const it of itemsOf(task)) {
      const kd = rec(it["keyword_data"]);
      const info = kd ? rec(kd["keyword_info"]) : null;
      const props = kd ? rec(kd["keyword_properties"]) : null;
      const el = rec(rec(it["ranked_serp_element"])?.["serp_item"]);
      const keyword = kd ? str(kd["keyword"]) : null;
      if (!keyword) continue;
      data.push({ keyword, position: el ? num(el["rank_group"]) : null, url: el ? str(el["url"]) : null, searchVolume: info ? num(info["search_volume"]) : null, cpc: info ? num(info["cpc"]) : null, keywordDifficulty: props ? num(props["keyword_difficulty"]) : null, etv: el ? num(el["etv"]) : null });
    }
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }

  async serpCompetitors(keywords: string[], market: MarketInput, limit: number) {
    const endpoint = "/v3/dataforseo_labs/google/serp_competitors/live";
    const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { keywords: keywords.slice(0, 200), location_code: market.locationCode, language_code: market.languageCode, limit: Math.min(limit, 1000), item_types: ["organic"] });
    const data = itemsOf(task)
      .map((it) => ({ domain: str(it["domain"]) ?? "", avgPosition: num(it["avg_position"]), keywordsCount: num(it["keywords_count"]), etv: num(it["etv"]) }))
      .filter((d) => d.domain);
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }
}

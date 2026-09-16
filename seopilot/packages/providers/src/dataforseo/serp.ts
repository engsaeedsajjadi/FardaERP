import type { Device, MarketInput, ProviderCall, SerpItem, SerpProvider, SerpSnapshot } from "../types";
import { DataForSeoClient, firstResult, num, rec, str } from "./client";

export const DEFAULT_SERP_DEPTH = 100;

export function normalizeSerpResult(result: Record<string, unknown> | null, query: string): SerpSnapshot {
  const items: SerpItem[] = [];
  const rawItems = result && Array.isArray(result["items"]) ? (result["items"] as unknown[]) : [];
  for (const raw of rawItems) {
    const it = rec(raw);
    if (!it) continue;
    const type = str(it["type"]) ?? "unknown";
    items.push({ type, rank: num(it["rank_group"]), rankAbsolute: num(it["rank_absolute"]), domain: str(it["domain"]), url: str(it["url"]), title: str(it["title"]), description: str(it["description"]) });
  }
  const features = result && Array.isArray(result["item_types"]) ? (result["item_types"] as unknown[]).filter((t): t is string => typeof t === "string") : [...new Set(items.map((i) => i.type))];
  return { query, checkUrl: result ? str(result["check_url"]) : null, resultCount: result ? num(result["se_results_count"]) : null, items, serpFeatures: features };
}

export class DataForSeoSerpProvider implements SerpProvider {
  readonly name = "dataforseo";
  constructor(private readonly client: DataForSeoClient) {}

  async liveSerp(query: string, market: MarketInput & { device: Device; depth?: number }): Promise<ProviderCall<SerpSnapshot>> {
    const endpoint = "/v3/serp/google/organic/live/advanced";
    const depth = Math.max(10, Math.min(700, market.depth ?? DEFAULT_SERP_DEPTH));
    const { task, cost } = await this.client.postTask<Record<string, unknown>>(
      endpoint,
      { keyword: query, location_code: market.locationCode, language_code: market.languageCode, device: market.device, os: market.device === "mobile" ? "android" : "windows", depth },
      { treatNoResultsAsEmpty: true },
    );
    return { data: normalizeSerpResult(firstResult(task), query), provider: this.name, cost, fetchedAt: new Date() };
  }
}

/** Find a domain's best organic position in a SERP snapshot (rank_group = organic-only counting, what users call "my ranking"). */
export function findDomainRank(snapshot: SerpSnapshot, domain: string): { position: number | null; url: string | null; competing: Array<{ url: string; position: number }> } {
  const target = domain.toLowerCase().replace(/^www\./, "");
  const matches = snapshot.items
    .filter((i) => i.type === "organic" && i.domain && i.rank !== null)
    .filter((i) => {
      const d = (i.domain as string).toLowerCase().replace(/^www\./, "");
      return d === target || d.endsWith(`.${target}`);
    })
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const best = matches[0];
  return {
    position: best?.rank ?? null,
    url: best?.url ?? null,
    competing: matches.slice(1).map((m) => ({ url: m.url ?? "", position: m.rank as number })),
  };
}

/**
 * Provider abstraction (spec: keyword/SERP/rank/competitor/backlink data must
 * come from swappable providers, DataForSEO first). Every method returns a
 * `ProviderCall<T>`: normalized data + the provider's own cost/metering facts,
 * so the caller (usage/credits layer) can meter honestly without provider-
 * specific knowledge.
 */
export interface ProviderCost {
  /** Provider-reported cost in USD for this call (null when the provider does not report it). */
  costUsd: number | null;
  /** Provider request/task identifier for audit trails. */
  requestId: string | null;
  /** Endpoint path (or logical operation) used. */
  endpoint: string;
}

export interface ProviderCall<T> {
  data: T;
  provider: string;
  cost: ProviderCost;
  fetchedAt: Date;
}

export type Device = "desktop" | "mobile";

export interface MarketInput {
  /** Google geotarget location code (e.g. 2840 = US). */
  locationCode: number;
  /** ISO 639-1 language code (e.g. "en"). */
  languageCode: string;
}

export interface KeywordMetricRow {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  /** 0–1 paid competition ratio. */
  competition: number | null;
  competitionLevel: string | null;
  /** 0–100 where available (Labs); null from Google Ads-only markets. */
  keywordDifficulty: number | null;
  intent: string | null;
  monthlySearches: Array<{ year: number; month: number; volume: number }>;
  serpFeatures: string[] | null;
}

export interface KeywordIdeaRow extends KeywordMetricRow {
  /** Where the idea came from. */
  source: "related" | "suggestions" | "ideas" | "ads" | "questions" | "ranked" | "gap";
  /** For competitor/ranked results: the URL ranking for the keyword and its position. */
  rankedUrl?: string | null;
  position?: number | null;
}

export interface SerpItem {
  type: string;
  rank: number | null;
  rankAbsolute: number | null;
  domain: string | null;
  url: string | null;
  title: string | null;
  description: string | null;
}

export interface SerpSnapshot {
  query: string;
  checkUrl: string | null;
  resultCount: number | null;
  items: SerpItem[];
  serpFeatures: string[];
}

export interface DomainOverview {
  domain: string;
  organicKeywords: number | null;
  organicTraffic: number | null;
  organicTrafficCost: number | null;
  /** Position buckets (1–3, 4–10, 11–20 …) when available. */
  positions: Record<string, number> | null;
}

export interface RankedKeywordRow {
  keyword: string;
  position: number | null;
  url: string | null;
  searchVolume: number | null;
  cpc: number | null;
  keywordDifficulty: number | null;
  etv: number | null;
}

export interface BacklinkSummary {
  target: string;
  backlinks: number | null;
  referringDomains: number | null;
  referringIps: number | null;
  dofollow: number | null;
  nofollow: number | null;
  /** Provider domain authority style metric (DataForSEO `rank`, 0–1000). */
  domainRank: number | null;
  brokenBacklinks: number | null;
  referringDomainsNofollow: number | null;
}

export interface BacklinkRow {
  sourceUrl: string;
  sourceDomain: string;
  targetUrl: string;
  anchor: string | null;
  isDofollow: boolean;
  linkType: string | null;
  domainRank: number | null;
  pageRank: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  isLost: boolean;
  spamScore: number | null;
}

export interface BacklinkAnchorRow {
  anchor: string;
  backlinks: number;
  referringDomains: number;
}

export interface KeywordDataProvider {
  readonly name: string;
  keywordMetrics(keywords: string[], market: MarketInput): Promise<ProviderCall<KeywordMetricRow[]>>;
  relatedKeywords(seed: string, market: MarketInput, limit: number): Promise<ProviderCall<KeywordIdeaRow[]>>;
  keywordSuggestions(seed: string, market: MarketInput, limit: number): Promise<ProviderCall<KeywordIdeaRow[]>>;
  keywordIdeas(seeds: string[], market: MarketInput, limit: number): Promise<ProviderCall<KeywordIdeaRow[]>>;
  keywordsForSite(domain: string, market: MarketInput, limit: number): Promise<ProviderCall<KeywordIdeaRow[]>>;
}

export interface SerpProvider {
  readonly name: string;
  liveSerp(query: string, market: MarketInput & { device: Device; depth?: number }): Promise<ProviderCall<SerpSnapshot>>;
}

export interface CompetitorProvider {
  readonly name: string;
  domainOverview(domain: string, market: MarketInput): Promise<ProviderCall<DomainOverview | null>>;
  rankedKeywords(domain: string, market: MarketInput, limit: number): Promise<ProviderCall<RankedKeywordRow[]>>;
  serpCompetitors(keywords: string[], market: MarketInput, limit: number): Promise<ProviderCall<Array<{ domain: string; avgPosition: number | null; keywordsCount: number | null; etv: number | null }>>>;
}

export interface BacklinkProvider {
  readonly name: string;
  summary(target: string): Promise<ProviderCall<BacklinkSummary>>;
  backlinks(target: string, limit: number, offset?: number): Promise<ProviderCall<BacklinkRow[]>>;
  anchors(target: string, limit: number): Promise<ProviderCall<BacklinkAnchorRow[]>>;
  referringDomains(target: string, limit: number): Promise<ProviderCall<Array<{ domain: string; backlinks: number; rank: number | null; firstSeen: string | null }>>>;
}

export type ProviderKind = "keywords" | "serp" | "competitors" | "backlinks";

export interface ProviderStatus {
  kind: ProviderKind;
  provider: string | null;
  configured: boolean;
  /** Human message shown in the UI when not configured. */
  reason: string | null;
}

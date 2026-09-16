import { googleApiError, type FetchLike } from "./google-oauth";

const GSC_API = "https://www.googleapis.com/webmasters/v3";
const INSPECT_API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsQuery {
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit?: number;
  startRow?: number;
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  dataState?: "final" | "all";
  dimensionFilterGroups?: Array<{ groupType?: "and"; filters: Array<{ dimension: string; operator: string; expression: string }> }>;
}

export interface UrlInspection {
  verdict: string | null;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  crawledAs: string | null;
  mobileUsabilityVerdict: string | null;
  richResultsVerdict: string | null;
  inspectionResultLink: string | null;
}

export class GscClient {
  constructor(private readonly accessToken: string, private readonly fetchImpl: FetchLike = fetch) {}

  private headers() {
    return { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" };
  }

  async listSites(): Promise<GscSite[]> {
    const res = await this.fetchImpl(`${GSC_API}/sites`, { headers: this.headers() });
    if (!res.ok) throw await googleApiError(res, "Search Console");
    const json = (await res.json()) as { siteEntry?: GscSite[] };
    return (json.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
  }

  async searchAnalytics(siteUrl: string, q: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]> {
    const res = await this.fetchImpl(`${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ startDate: q.startDate, endDate: q.endDate, dimensions: q.dimensions, rowLimit: Math.min(q.rowLimit ?? 25000, 25000), startRow: q.startRow ?? 0, type: q.type ?? "web", dataState: q.dataState ?? "final", dimensionFilterGroups: q.dimensionFilterGroups }),
    });
    if (!res.ok) throw await googleApiError(res, "Search Console");
    const json = (await res.json()) as { rows?: Array<{ keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }> };
    return (json.rows ?? []).map((r) => ({ keys: r.keys ?? [], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
  }

  /** Pages through the 25k row limit. */
  async searchAnalyticsAll(siteUrl: string, q: SearchAnalyticsQuery, maxRows = 100_000): Promise<SearchAnalyticsRow[]> {
    const out: SearchAnalyticsRow[] = [];
    let startRow = 0;
    while (out.length < maxRows) {
      const rows = await this.searchAnalytics(siteUrl, { ...q, startRow, rowLimit: 25000 });
      out.push(...rows);
      if (rows.length < 25000) break;
      startRow += 25000;
    }
    return out;
  }

  async listSitemaps(siteUrl: string): Promise<Array<{ path: string; lastSubmitted: string | null; isPending: boolean; errors: number; warnings: number; lastDownloaded: string | null }>> {
    const res = await this.fetchImpl(`${GSC_API}/sites/${encodeURIComponent(siteUrl)}/sitemaps`, { headers: this.headers() });
    if (!res.ok) throw await googleApiError(res, "Search Console");
    const json = (await res.json()) as { sitemap?: Array<{ path: string; lastSubmitted?: string; isPending?: boolean; errors?: string; warnings?: string; lastDownloaded?: string }> };
    return (json.sitemap ?? []).map((s) => ({ path: s.path, lastSubmitted: s.lastSubmitted ?? null, isPending: Boolean(s.isPending), errors: Number(s.errors ?? 0), warnings: Number(s.warnings ?? 0), lastDownloaded: s.lastDownloaded ?? null }));
  }

  async submitSitemap(siteUrl: string, feedPath: string): Promise<void> {
    const res = await this.fetchImpl(`${GSC_API}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedPath)}`, { method: "PUT", headers: this.headers() });
    if (!res.ok) throw await googleApiError(res, "Search Console");
  }

  async inspectUrl(siteUrl: string, inspectionUrl: string, languageCode = "en-US"): Promise<UrlInspection> {
    const res = await this.fetchImpl(INSPECT_API, { method: "POST", headers: this.headers(), body: JSON.stringify({ inspectionUrl, siteUrl, languageCode }) });
    if (!res.ok) throw await googleApiError(res, "Search Console");
    const json = (await res.json()) as { inspectionResult?: { inspectionResultLink?: string; indexStatusResult?: Record<string, unknown>; mobileUsabilityResult?: { verdict?: string }; richResultsResult?: { verdict?: string } } };
    const r = json.inspectionResult ?? {};
    const idx = r.indexStatusResult ?? {};
    const s = (k: string) => (typeof idx[k] === "string" ? (idx[k] as string) : null);
    return { verdict: s("verdict"), coverageState: s("coverageState"), indexingState: s("indexingState"), robotsTxtState: s("robotsTxtState"), pageFetchState: s("pageFetchState"), lastCrawlTime: s("lastCrawlTime"), googleCanonical: s("googleCanonical"), userCanonical: s("userCanonical"), crawledAs: s("crawledAs"), mobileUsabilityVerdict: r.mobileUsabilityResult?.verdict ?? null, richResultsVerdict: r.richResultsResult?.verdict ?? null, inspectionResultLink: r.inspectionResultLink ?? null };
  }
}

/** Does a GSC property cover this site URL? (sc-domain: covers all protocols/subdomains). */
export function propertyMatchesSite(property: string, siteUrl: string): boolean {
  try {
    const host = new URL(siteUrl).hostname.replace(/^www\./, "");
    if (property.startsWith("sc-domain:")) {
      const d = property.slice("sc-domain:".length).toLowerCase();
      return host === d || host.endsWith(`.${d}`);
    }
    const p = new URL(property);
    return p.hostname.replace(/^www\./, "") === host;
  } catch {
    return false;
  }
}

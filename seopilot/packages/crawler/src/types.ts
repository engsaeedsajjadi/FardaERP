export type FetchClass =
  | "ok" | "redirect" | "client_error" | "server_error" | "blocked" | "rate_limited" | "timeout"
  | "network_error" | "ssrf_blocked" | "too_large" | "skipped_robots";

export type DiscoverySource = "start" | "link" | "sitemap" | "redirect" | "canonical" | "hreflang";

export interface PageLink {
  href: string;
  normalized: string;
  anchor: string | null;
  rel: string | null;
  isInternal: boolean;
  isNofollow: boolean;
}

export interface StructuredDataItem {
  format: "json-ld" | "microdata" | "rdfa";
  type: string;
  /** No parse errors and no missing required properties. */
  valid: boolean;
  /** Parse errors and missing required properties. */
  errors: string[];
  /** Missing recommended properties (do not affect validity). */
  warnings: string[];
  raw?: unknown;
}

export interface PageAnalysis {
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  isIndexable: boolean;
  isNofollow: boolean;
  h1s: string[];
  headingOutline: Array<{ level: number; text: string }>;
  wordCount: number;
  contentHash: string;
  lang: string | null;
  hreflang: Array<{ lang: string; href: string }>;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  images: Array<{ src: string; alt: string | null }>;
  imageCount: number;
  imagesMissingAlt: number;
  links: PageLink[];
  internalLinkCount: number;
  externalLinkCount: number;
  structuredData: StructuredDataItem[];
  mixedContent: string[];
  paginationRel: { prev: string | null; next: string | null } | null;
  viewportMeta: boolean;
  /** Body text sample (first N chars) for duplicate / thin content analysis. */
  textSample: string;
  resourceUrls: { scripts: string[]; stylesheets: string[] };
}

export interface CrawledPage {
  url: string;
  normalizedUrl: string;
  depth: number;
  discoveredFrom: string | null;
  discoverySource: DiscoverySource;
  statusCode: number | null;
  fetchClass: FetchClass;
  contentType: string | null;
  isHtml: boolean;
  redirectUrl: string | null;
  redirectChain: Array<{ url: string; status: number }>;
  responseTimeMs: number | null;
  ttfbMs: number | null;
  byteLength: number | null;
  contentEncoding: string | null;
  isHttps: boolean;
  headerCanonicalUrl: string | null;
  xRobotsTag: string | null;
  renderedWithJs: boolean;
  errorMessage: string | null;
  analysis: PageAnalysis | null;
}

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  delayMs: number;
  respectRobots: boolean;
  renderJavaScript: boolean;
  userAgent: string;
  includePatterns: string[];
  excludePatterns: string[];
  /** Check status of external link targets with HEAD requests (bounded). */
  checkExternalLinks: boolean;
  maxExternalChecks: number;
  timeoutMs: number;
  maxBytes: number;
  /** Overall wall-clock budget. */
  maxDurationMs: number;
  /** SSRF allow list for self-hosted intranet audits. */
  allowHosts?: string[];
  /** Extra ports permitted (only honoured together with allowHosts, e.g. intranet staging on :3000). */
  allowPorts?: number[];
  signal?: AbortSignal;
}

export interface CrawlProgress {
  crawled: number;
  discovered: number;
  failed: number;
  inFlight: number;
}

export interface CrawlEvents {
  onPage?: (page: CrawledPage) => Promise<void> | void;
  onProgress?: (p: CrawlProgress) => void;
  onLog?: (level: "info" | "warn", msg: string, meta?: Record<string, unknown>) => void;
}

export interface CrawlSummary {
  startUrl: string;
  finalStartUrl: string;
  pagesCrawled: number;
  pagesDiscovered: number;
  pagesFailed: number;
  stopReason: "frontier_exhausted" | "max_pages" | "max_duration" | "aborted" | "start_url_failed";
  robotsTxt: string | null;
  robotsTxtFound: boolean;
  sitemapUrls: string[];
  sitemapEntries: Array<{ sitemapUrl: string; url: string; normalizedUrl: string; lastmod: string | null; changefreq: string | null; priority: number | null }>;
  externalLinkStatus: Map<string, number | null>;
  durationMs: number;
}

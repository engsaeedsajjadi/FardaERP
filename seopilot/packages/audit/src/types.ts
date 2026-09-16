/**
 * Audit engine types. The engine is pure: it receives an in-memory snapshot of a
 * crawl (pages + link graph + site facts) and returns findings plus a
 * transparent score. Persistence is the worker's job.
 */
export const SEVERITIES = ["critical", "high", "medium", "low", "notice"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = ["indexability", "content", "metadata", "links", "performance", "security", "structured_data", "images", "international", "mobile"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface AuditLink {
  targetNormalizedUrl: string;
  anchor: string | null;
  isInternal: boolean;
  isNofollow: boolean;
}

/** Compact page snapshot consumed by rules (mirrors crawl_pages columns). */
export interface AuditPage {
  url: string;
  normalizedUrl: string;
  depth: number;
  discoverySource: string;
  statusCode: number | null;
  fetchClass: string;
  isHtml: boolean;
  redirectUrl: string | null;
  redirectChain: Array<{ url: string; status: number }>;
  responseTimeMs: number | null;
  ttfbMs: number | null;
  byteLength: number | null;
  contentEncoding: string | null;
  isHttps: boolean;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  headerCanonicalUrl: string | null;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  responseHeaders: Record<string, string>;
  isIndexable: boolean;
  isNofollow: boolean;
  h1s: string[];
  headingOutline: Array<{ level: number; text: string }>;
  wordCount: number;
  contentHash: string | null;
  lang: string | null;
  hreflang: Array<{ lang: string; href: string }>;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  imageCount: number;
  imagesMissingAlt: number;
  images: Array<{ src: string; alt: string | null }>;
  internalLinkCount: number;
  externalLinkCount: number;
  structuredData: Array<{ format: string; type: string; valid: boolean; errors: string[]; warnings: string[] }>;
  mixedContent: string[];
  viewportMeta: boolean;
  renderedWithJs: boolean;
  inSitemap: boolean;
  links: AuditLink[];
}

export interface AuditSite {
  startUrl: string;
  finalStartUrl: string;
  robotsTxtFound: boolean;
  robotsTxt: string | null;
  sitemapUrls: string[];
  sitemapEntries: Array<{ url: string; normalizedUrl: string; lastmod: string | null }>;
  stopReason: string;
}

export interface AuditInput {
  site: AuditSite;
  pages: AuditPage[];
  /** Known HTTP status of link targets not crawled as pages (external HEAD checks). null = checked but unreachable. */
  externalLinkStatus: Map<string, number | null>;
}

/** Derived, shared lookups computed once per run. */
export interface AuditContext extends AuditInput {
  byUrl: Map<string, AuditPage>;
  inbound: Map<string, number>;
  inboundNofollowOnly: Set<string>;
  sitemapSet: Set<string>;
  /** HTML pages that returned 200 and are indexable: the denominator for most on-page rules. */
  indexablePages: AuditPage[];
  /** HTML pages that returned 200 (indexable or not). */
  htmlPages: AuditPage[];
  /** Status of any URL we know about (crawled or externally checked). undefined = unknown/never checked. */
  statusOf: (normalizedUrl: string) => number | null | undefined;
  homepage: AuditPage | null;
}

export interface FindingDraft {
  /** Page the finding is attached to (null for site-wide). */
  pageUrl: string | null;
  /** Deterministic key within (run, rule); defaults to pageUrl. */
  dedupeKey?: string;
  evidence: Record<string, unknown>;
}

export interface RuleDefinition {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  documentationUrl: string | null;
  /** Relative importance within its category (1–3). */
  weight: number;
  /** For page rules, which pages the rule is applicable to (denominator for the affected ratio). */
  scope: "page" | "site";
  /** Page rule: applies-to predicate (default: indexable 200 HTML pages). */
  appliesTo?: (page: AuditPage, ctx: AuditContext) => boolean;
  /** Page rule body. */
  checkPage?: (page: AuditPage, ctx: AuditContext) => FindingDraft[] | FindingDraft | null;
  /** Site rule body. */
  checkSite?: (ctx: AuditContext) => FindingDraft[] | FindingDraft | null;
}

export interface Finding extends FindingDraft {
  ruleId: string;
  category: Category;
  severity: Severity;
  dedupeKey: string;
}

export interface RuleResult {
  ruleId: string;
  category: Category;
  severity: Severity;
  weight: number;
  findings: number;
  applicable: number;
  affectedRatio: number;
  penalty: number;
  durationMs: number;
  error: string | null;
}

export interface CategoryScore {
  score: number;
  weight: number;
  findings: number;
  /** Human-readable explanation of how the score was derived. */
  explanation: string;
  topRules: Array<{ ruleId: string; penalty: number; findings: number }>;
}

export interface AuditResult {
  findings: Finding[];
  rules: RuleResult[];
  scoreOverall: number;
  scoreBreakdown: Record<string, CategoryScore>;
  issueCounts: Record<Severity, number>;
  pagesEvaluated: number;
  durationMs: number;
  /** Scoring configuration used, embedded so historic scores stay reproducible. */
  scoringVersion: string;
}

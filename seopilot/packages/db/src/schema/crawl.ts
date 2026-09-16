import { pgTable, text, timestamp, boolean, integer, real, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./_common";
import { projects } from "./projects";
import { organizations } from "./tenancy";
import { jobs } from "./automation";

export const CRAWL_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;

export const crawlRuns = pgTable("crawl_runs", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  status: text("status", { enum: CRAWL_STATUSES }).notNull().default("queued"),
  startUrl: text("start_url").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  pagesCrawled: integer("pages_crawled").notNull().default(0),
  pagesDiscovered: integer("pages_discovered").notNull().default(0),
  pagesFailed: integer("pages_failed").notNull().default(0),
  sitemapUrlCount: integer("sitemap_url_count").notNull().default(0),
  robotsTxtFound: boolean("robots_txt_found"),
  robotsTxt: text("robots_txt"),
  sitemapUrls: jsonb("sitemap_urls").$type<string[]>().notNull().default([]),
  /** Explicit reason when the crawl stopped before exhausting the frontier. */
  stopReason: text("stop_reason"),
  errorMessage: text("error_message"),
  scoreOverall: integer("score_overall"),
  scoreBreakdown: jsonb("score_breakdown").$type<Record<string, { score: number; weight: number; findings: number; explanation: string }>>(),
  issueCounts: jsonb("issue_counts").$type<Record<string, number>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  triggeredBy: text("triggered_by").notNull().default("manual"), // manual | schedule | api | onboarding
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("crawl_runs_project_created_idx").on(t.projectId, t.createdAt), index("crawl_runs_org_idx").on(t.organizationId), index("crawl_runs_status_idx").on(t.status)]);

export const crawlPages = pgTable("crawl_pages", {
  id: id(),
  crawlRunId: text("crawl_run_id").notNull().references(() => crawlRuns.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url").notNull(),
  depth: integer("depth").notNull().default(0),
  discoveredFrom: text("discovered_from"), // parent URL
  discoverySource: text("discovery_source", { enum: ["start", "link", "sitemap", "redirect", "canonical", "hreflang"] }).notNull().default("link"),
  statusCode: integer("status_code"),
  fetchClass: text("fetch_class", { enum: ["ok", "redirect", "client_error", "server_error", "blocked", "rate_limited", "timeout", "network_error", "ssrf_blocked", "too_large", "skipped_robots"] }).notNull(),
  contentType: text("content_type"),
  isHtml: boolean("is_html").notNull().default(false),
  redirectUrl: text("redirect_url"),
  redirectChain: jsonb("redirect_chain").$type<Array<{ url: string; status: number }>>().notNull().default([]),
  responseTimeMs: integer("response_time_ms"),
  ttfbMs: integer("ttfb_ms"),
  byteLength: integer("byte_length"),
  contentEncoding: text("content_encoding"),
  isHttps: boolean("is_https").notNull().default(false),
  title: text("title"),
  metaDescription: text("meta_description"),
  canonicalUrl: text("canonical_url"),
  headerCanonicalUrl: text("header_canonical_url"),
  robotsMeta: text("robots_meta"),
  xRobotsTag: text("x_robots_tag"),
  responseHeaders: jsonb("response_headers").$type<Record<string, string>>().notNull().default({}),
  isIndexable: boolean("is_indexable").notNull().default(true),
  isNofollow: boolean("is_nofollow").notNull().default(false),
  h1s: jsonb("h1s").$type<string[]>().notNull().default([]),
  headingOutline: jsonb("heading_outline").$type<Array<{ level: number; text: string }>>().notNull().default([]),
  wordCount: integer("word_count").notNull().default(0),
  contentHash: text("content_hash"),
  lang: text("lang"),
  hreflang: jsonb("hreflang").$type<Array<{ lang: string; href: string }>>().notNull().default([]),
  ogTitle: text("og_title"),
  ogDescription: text("og_description"),
  ogImage: text("og_image"),
  imageCount: integer("image_count").notNull().default(0),
  imagesMissingAlt: integer("images_missing_alt").notNull().default(0),
  images: jsonb("images").$type<Array<{ src: string; alt: string | null }>>().notNull().default([]),
  internalLinkCount: integer("internal_link_count").notNull().default(0),
  externalLinkCount: integer("external_link_count").notNull().default(0),
  inboundLinkCount: integer("inbound_link_count").notNull().default(0),
  structuredData: jsonb("structured_data").$type<Array<{ format: "json-ld" | "microdata" | "rdfa"; type: string; valid: boolean; errors: string[]; warnings: string[]; raw?: unknown }>>().notNull().default([]),
  mixedContent: jsonb("mixed_content").$type<string[]>().notNull().default([]),
  paginationRel: jsonb("pagination_rel").$type<{ prev: string | null; next: string | null }>(),
  inSitemap: boolean("in_sitemap").notNull().default(false),
  viewportMeta: boolean("viewport_meta").notNull().default(false),
  renderedWithJs: boolean("rendered_with_js").notNull().default(false),
  errorMessage: text("error_message"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("crawl_pages_run_url_uq").on(t.crawlRunId, t.normalizedUrl),
  index("crawl_pages_project_idx").on(t.projectId),
  index("crawl_pages_run_status_idx").on(t.crawlRunId, t.statusCode),
  index("crawl_pages_run_hash_idx").on(t.crawlRunId, t.contentHash),
]);

export const crawlLinks = pgTable("crawl_links", {
  id: id(),
  crawlRunId: text("crawl_run_id").notNull().references(() => crawlRuns.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourcePageId: text("source_page_id").notNull().references(() => crawlPages.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  targetUrl: text("target_url").notNull(),
  targetNormalizedUrl: text("target_normalized_url").notNull(),
  anchorText: text("anchor_text"),
  isInternal: boolean("is_internal").notNull(),
  isNofollow: boolean("is_nofollow").notNull().default(false),
  rel: text("rel"),
  /** Status of the target when checked (internal always; external when enabled). */
  targetStatusCode: integer("target_status_code"),
}, (t) => [index("crawl_links_run_target_idx").on(t.crawlRunId, t.targetNormalizedUrl), index("crawl_links_run_source_idx").on(t.crawlRunId, t.sourcePageId)]);

export const auditRules = pgTable("audit_rules", {
  id: text("id").primaryKey(), // e.g. "meta.title.missing"
  category: text("category").notNull(),
  severity: text("severity", { enum: ["critical", "high", "medium", "low", "notice"] }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  recommendation: text("recommendation").notNull(),
  documentationUrl: text("documentation_url"),
  weight: integer("weight").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: updatedAt(),
});

export const auditFindings = pgTable("audit_findings", {
  id: id(),
  crawlRunId: text("crawl_run_id").notNull().references(() => crawlRuns.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").notNull().references(() => auditRules.id, { onDelete: "restrict" }),
  severity: text("severity", { enum: ["critical", "high", "medium", "low", "notice"] }).notNull(),
  category: text("category").notNull(),
  pageId: text("page_id").references(() => crawlPages.id, { onDelete: "set null" }),
  pageUrl: text("page_url"),
  /** Deterministic per (run, rule, page, dedupeKey) so retries don't duplicate. */
  dedupeKey: text("dedupe_key").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status", { enum: ["open", "fixed", "ignored", "false_positive"] }).notNull().default("open"),
  firstSeenRunId: text("first_seen_run_id"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("audit_findings_dedupe_uq").on(t.crawlRunId, t.ruleId, t.dedupeKey),
  index("audit_findings_run_rule_idx").on(t.crawlRunId, t.ruleId),
  index("audit_findings_project_idx").on(t.projectId),
  index("audit_findings_run_severity_idx").on(t.crawlRunId, t.severity),
]);

export const sitemapEntries = pgTable("sitemap_entries", {
  id: id(),
  crawlRunId: text("crawl_run_id").notNull().references(() => crawlRuns.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sitemapUrl: text("sitemap_url").notNull(),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url").notNull(),
  lastmod: timestamp("lastmod", { withTimezone: true }),
  changefreq: text("changefreq"),
  priority: real("priority"),
  crawled: boolean("crawled").notNull().default(false),
  statusCode: integer("status_code"),
}, (t) => [uniqueIndex("sitemap_entries_run_url_uq").on(t.crawlRunId, t.normalizedUrl), index("sitemap_entries_project_idx").on(t.projectId)]);

export const pagespeedResults = pgTable("pagespeed_results", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  strategy: text("strategy", { enum: ["mobile", "desktop"] }).notNull(),
  performanceScore: integer("performance_score"),
  accessibilityScore: integer("accessibility_score"),
  bestPracticesScore: integer("best_practices_score"),
  seoScore: integer("seo_score"),
  /** Lab metrics from Lighthouse (ms / unitless). */
  lcpMs: integer("lcp_ms"),
  clsValue: real("cls_value"),
  inpMs: integer("inp_ms"),
  ttfbMs: integer("ttfb_ms"),
  fcpMs: integer("fcp_ms"),
  tbtMs: integer("tbt_ms"),
  speedIndexMs: integer("speed_index_ms"),
  /** Field data (CrUX) when Google returns it; null otherwise. */
  fieldLcpMs: integer("field_lcp_ms"),
  fieldCls: real("field_cls"),
  fieldInpMs: integer("field_inp_ms"),
  fieldOverallCategory: text("field_overall_category"),
  lighthouseVersion: text("lighthouse_version"),
  rawStorageKey: text("raw_storage_key"),
  errorMessage: text("error_message"),
  provider: text("provider").notNull().default("google_pagespeed"),
  providerRequestId: text("provider_request_id"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("pagespeed_project_url_idx").on(t.projectId, t.url, t.fetchedAt)]);

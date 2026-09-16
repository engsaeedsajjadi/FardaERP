import { pgTable, text, timestamp, boolean, integer, real, date, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./_common";
import { competitors, projects } from "./projects";
import { organizations } from "./tenancy";
import { users } from "./auth";
import { jobs } from "./automation";

export const keywordGroups = pgTable("keyword_groups", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  /** Cluster provenance when created by clustering. */
  clusterMethod: text("cluster_method"),
  clusterMeta: jsonb("cluster_meta").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("keyword_groups_project_name_uq").on(t.projectId, t.name)]);

export const keywords = pgTable("keywords", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  groupId: text("group_id").references(() => keywordGroups.id, { onDelete: "set null" }),
  keyword: text("keyword").notNull(),
  normalizedKeyword: text("normalized_keyword").notNull(),
  country: text("country").notNull(),
  language: text("language").notNull(),
  locationCode: integer("location_code"),
  device: text("device", { enum: ["desktop", "mobile"] }).notNull().default("desktop"),
  searchEngine: text("search_engine").notNull().default("google"),
  isTracked: boolean("is_tracked").notNull().default(true),
  targetUrl: text("target_url"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  intent: text("intent"), // informational | navigational | commercial | transactional
  intentSource: text("intent_source"), // provider | heuristic
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("keywords_project_kw_ctx_uq").on(t.projectId, t.normalizedKeyword, t.country, t.language, t.device, t.searchEngine),
  index("keywords_project_tracked_idx").on(t.projectId, t.isTracked),
  index("keywords_org_idx").on(t.organizationId),
]);

/** Provider-sourced keyword metrics; one row per (keyword text, country, language, provider, fetch). */
export const keywordMetrics = pgTable("keyword_metrics", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  keywordId: text("keyword_id").references(() => keywords.id, { onDelete: "cascade" }),
  keyword: text("keyword").notNull(),
  country: text("country").notNull(),
  language: text("language").notNull(),
  searchVolume: integer("search_volume"),
  cpc: real("cpc"),
  competition: real("competition"),
  competitionLevel: text("competition_level"),
  keywordDifficulty: integer("keyword_difficulty"),
  intent: text("intent"),
  serpFeatures: jsonb("serp_features").$type<string[]>(),
  monthlySearches: jsonb("monthly_searches").$type<Array<{ year: number; month: number; volume: number }>>(),
  provider: text("provider").notNull(),
  providerRequestId: text("provider_request_id"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("keyword_metrics_lookup_idx").on(t.organizationId, t.keyword, t.country, t.language, t.fetchedAt), index("keyword_metrics_keyword_id_idx").on(t.keywordId)]);

/** Research results (ideas, related, competitor keywords, gaps) kept for history/export. */
export const keywordResearchRuns = pgTable("keyword_research_runs", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["seed", "related", "url", "competitor_domain", "topic", "gap", "questions"] }).notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  country: text("country").notNull(),
  language: text("language").notNull(),
  resultCount: integer("result_count").notNull().default(0),
  results: jsonb("results").$type<unknown[]>().notNull().default([]),
  provider: text("provider").notNull(),
  providerRequestId: text("provider_request_id"),
  costCredits: integer("cost_credits").notNull().default(0),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [index("keyword_research_project_idx").on(t.projectId, t.createdAt)]);

export const serpResults = pgTable("serp_results", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  keywordId: text("keyword_id").references(() => keywords.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  searchEngine: text("search_engine").notNull(),
  country: text("country").notNull(),
  language: text("language").notNull(),
  locationCode: integer("location_code"),
  device: text("device", { enum: ["desktop", "mobile"] }).notNull(),
  resultCount: integer("result_count"),
  items: jsonb("items").$type<Array<{ type: string; rank: number | null; rankAbsolute: number | null; domain: string | null; url: string | null; title: string | null; description: string | null }>>().notNull().default([]),
  serpFeatures: jsonb("serp_features").$type<string[]>().notNull().default([]),
  checkUrl: text("check_url"),
  provider: text("provider").notNull(),
  providerRequestId: text("provider_request_id"),
  costCredits: integer("cost_credits").notNull().default(0),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("serp_results_keyword_fetched_idx").on(t.keywordId, t.fetchedAt), index("serp_results_project_idx").on(t.projectId, t.fetchedAt)]);

export const rankCheckRuns = pgTable("rank_check_runs", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  status: text("status", { enum: ["queued", "running", "completed", "failed", "partial"] }).notNull().default("queued"),
  keywordCount: integer("keyword_count").notNull().default(0),
  checkedCount: integer("checked_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  provider: text("provider"),
  costCredits: integer("cost_credits").notNull().default(0),
  errorMessage: text("error_message"),
  triggeredBy: text("triggered_by").notNull().default("manual"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("rank_check_runs_project_idx").on(t.projectId, t.createdAt)]);

export const keywordRankings = pgTable("keyword_rankings", {
  id: id(),
  keywordId: text("keyword_id").notNull().references(() => keywords.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  rankCheckRunId: text("rank_check_run_id").references(() => rankCheckRuns.id, { onDelete: "set null" }),
  serpResultId: text("serp_result_id").references(() => serpResults.id, { onDelete: "set null" }),
  checkedOn: date("checked_on").notNull(),
  position: integer("position"), // null = not in top N
  previousPosition: integer("previous_position"),
  url: text("url"),
  searchEngine: text("search_engine").notNull(),
  country: text("country").notNull(),
  language: text("language").notNull(),
  device: text("device", { enum: ["desktop", "mobile"] }).notNull(),
  serpFeatures: jsonb("serp_features").$type<string[]>().notNull().default([]),
  /** Other URLs of the project's domain in the same SERP -> cannibalization evidence. */
  competingUrls: jsonb("competing_urls").$type<Array<{ url: string; position: number }>>().notNull().default([]),
  topCompetitors: jsonb("top_competitors").$type<Array<{ domain: string; url: string; position: number }>>().notNull().default([]),
  provider: text("provider").notNull(),
  providerRequestId: text("provider_request_id"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("keyword_rankings_keyword_day_uq").on(t.keywordId, t.checkedOn),
  index("keyword_rankings_project_day_idx").on(t.projectId, t.checkedOn),
]);

export const competitorSnapshots = pgTable("competitor_snapshots", {
  id: id(),
  competitorId: text("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  country: text("country").notNull(),
  language: text("language").notNull(),
  organicKeywords: integer("organic_keywords"),
  organicTraffic: real("organic_traffic"),
  organicTrafficCost: real("organic_traffic_cost"),
  topPages: jsonb("top_pages").$type<Array<{ url: string; keywords: number; traffic: number | null }>>(),
  rankedKeywords: jsonb("ranked_keywords").$type<Array<{ keyword: string; position: number; url: string | null; volume: number | null }>>(),
  referringDomains: integer("referring_domains"),
  backlinks: integer("backlinks"),
  domainRank: integer("domain_rank"),
  provider: text("provider").notNull(),
  providerRequestId: text("provider_request_id"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("competitor_snapshots_project_domain_idx").on(t.projectId, t.domain, t.fetchedAt)]);

export const backlinkSnapshots = pgTable("backlink_snapshots", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  backlinks: integer("backlinks"),
  referringDomains: integer("referring_domains"),
  referringIps: integer("referring_ips"),
  dofollow: integer("dofollow"),
  nofollow: integer("nofollow"),
  domainRank: integer("domain_rank"),
  brokenBacklinks: integer("broken_backlinks"),
  newLast30: integer("new_last_30"),
  lostLast30: integer("lost_last_30"),
  anchors: jsonb("anchors").$type<Array<{ anchor: string; backlinks: number; referringDomains: number }>>(),
  provider: text("provider").notNull(),
  providerRequestId: text("provider_request_id"),
  costCredits: integer("cost_credits").notNull().default(0),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("backlink_snapshots_project_idx").on(t.projectId, t.fetchedAt)]);

export const backlinks = pgTable("backlinks", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceDomain: text("source_domain").notNull(),
  targetUrl: text("target_url").notNull(),
  anchor: text("anchor"),
  isDofollow: boolean("is_dofollow").notNull().default(true),
  linkType: text("link_type"),
  domainRank: integer("domain_rank"),
  pageRank: integer("page_rank"),
  firstSeen: timestamp("first_seen", { withTimezone: true }),
  lastSeen: timestamp("last_seen", { withTimezone: true }),
  isLost: boolean("is_lost").notNull().default(false),
  lostAt: timestamp("lost_at", { withTimezone: true }),
  provider: text("provider").notNull(),
  providerRequestId: text("provider_request_id"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("backlinks_project_src_tgt_uq").on(t.projectId, t.sourceUrl, t.targetUrl),
  index("backlinks_project_domain_idx").on(t.projectId, t.sourceDomain),
  index("backlinks_project_lost_idx").on(t.projectId, t.isLost),
]);

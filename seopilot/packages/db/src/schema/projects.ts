import { pgTable, text, timestamp, boolean, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, deletedAt } from "./_common";
import { organizations } from "./tenancy";
import { users } from "./auth";

export interface CrawlConfig {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  delayMs: number;
  respectRobots: boolean;
  renderJavaScript: boolean;
  userAgent: string | null;
  includePatterns: string[];
  excludePatterns: string[];
  followExternalLinksForStatus: boolean;
}

export const DEFAULT_CRAWL_CONFIG: CrawlConfig = {
  maxPages: 500,
  maxDepth: 10,
  concurrency: 4,
  delayMs: 250,
  respectRobots: true,
  renderJavaScript: false,
  userAgent: null,
  includePatterns: [],
  excludePatterns: [],
  followExternalLinksForStatus: true,
};

export const projects = pgTable("projects", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  /** Canonical start URL (scheme + host), resolved during verification. */
  siteUrl: text("site_url").notNull(),
  country: text("country").notNull().default("US"), // ISO 3166-1 alpha-2
  language: text("language").notNull().default("en"), // ISO 639-1
  timezone: text("timezone").notNull().default("UTC"),
  searchEngines: jsonb("search_engines").$type<string[]>().notNull().default(["google"]),
  devices: jsonb("devices").$type<Array<"desktop" | "mobile">>().notNull().default(["desktop", "mobile"]),
  /** DataForSEO location code resolved from country (nullable until resolved). */
  locationCode: integer("location_code"),
  brandName: text("brand_name"),
  brandAliases: jsonb("brand_aliases").$type<string[]>().notNull().default([]),
  crawlConfig: jsonb("crawl_config").$type<CrawlConfig>().notNull().default(DEFAULT_CRAWL_CONFIG),
  domainVerificationToken: text("domain_verification_token"),
  domainVerifiedAt: timestamp("domain_verified_at", { withTimezone: true }),
  domainVerificationMethod: text("domain_verification_method"), // dns_txt | html_file | meta_tag | gsc
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  index("projects_org_idx").on(t.organizationId),
  uniqueIndex("projects_org_domain_uq").on(t.organizationId, t.domain),
]);

/** A project can track several hostnames/properties (www vs apex, subdomains, GSC property). */
export const websites = pgTable("websites", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull(),
  url: text("url").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  robotsTxt: text("robots_txt"),
  robotsFetchedAt: timestamp("robots_fetched_at", { withTimezone: true }),
  sitemapUrls: jsonb("sitemap_urls").$type<string[]>().notNull().default([]),
  httpsSupported: boolean("https_supported"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("websites_project_idx").on(t.projectId), uniqueIndex("websites_project_host_uq").on(t.projectId, t.hostname)]);

export const competitors = pgTable("competitors", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  name: text("name"),
  source: text("source", { enum: ["manual", "discovered"] }).notNull().default("manual"),
  /** Provenance of discovery. */
  discoveredVia: text("discovered_via"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("competitors_project_idx").on(t.projectId), uniqueIndex("competitors_project_domain_uq").on(t.projectId, t.domain)]);

export const projectIntegrations = pgTable("project_integrations", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["gsc", "ga4", "slack", "discord", "telegram", "webhook"] }).notNull(),
  status: text("status", { enum: ["connected", "needs_reauth", "disconnected", "error"] }).notNull().default("connected"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  /** AES-GCM encrypted credential blob (OAuth tokens, webhook secrets). Never returned to clients. */
  encryptedCredentials: text("encrypted_credentials"),
  lastError: text("last_error"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("project_integrations_project_kind_uq").on(t.projectId, t.kind), index("project_integrations_org_idx").on(t.organizationId)]);

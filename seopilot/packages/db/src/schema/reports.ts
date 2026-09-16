import { pgTable, text, timestamp, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./_common";
import { projects } from "./projects";
import { organizations } from "./tenancy";
import { schedules } from "./automation";
import { users } from "./auth";

export const REPORT_TYPES = ["seo", "technical_audit", "keywords", "rankings", "competitors", "backlinks", "gsc", "ai_visibility", "executive", "agency_client"] as const;
export const REPORT_FORMATS = ["pdf", "html", "csv", "json"] as const;

export const reports = pgTable("reports", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  scheduleId: text("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
  type: text("type", { enum: REPORT_TYPES }).notNull(),
  format: text("format", { enum: REPORT_FORMATS }).notNull(),
  title: text("title").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  status: text("status", { enum: ["queued", "generating", "ready", "failed"] }).notNull().default("queued"),
  storageKey: text("storage_key"),
  sizeBytes: integer("size_bytes"),
  /** Data sections actually included, with provenance, so the reader knows what was measured. */
  sections: jsonb("sections").$type<Array<{ key: string; status: "included" | "not_connected" | "no_data"; provider?: string }>>().notNull().default([]),
  brandingSnapshot: jsonb("branding_snapshot").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  generatedBy: text("generated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("reports_project_created_idx").on(t.projectId, t.createdAt), index("reports_org_idx").on(t.organizationId)]);

export const reportSchedules = pgTable("report_schedules", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  scheduleId: text("schedule_id").notNull().references(() => schedules.id, { onDelete: "restrict" }),
  type: text("type", { enum: REPORT_TYPES }).notNull(),
  format: text("format", { enum: REPORT_FORMATS }).notNull().default("pdf"),
  /** Member user ids, plus external emails. */
  recipientUserIds: jsonb("recipient_user_ids").$type<string[]>().notNull().default([]),
  recipientEmails: jsonb("recipient_emails").$type<string[]>().notNull().default([]),
  includeShareLink: boolean("include_share_link").notNull().default(true),
  shareLinkTtlDays: integer("share_link_ttl_days").notNull().default(30),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("report_schedules_project_idx").on(t.projectId)]);

export const reportShares = pgTable("report_shares", {
  id: id(),
  reportId: text("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  passwordHash: text("password_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  maxViews: integer("max_views"),
  viewCount: integer("view_count").notNull().default(0),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("report_shares_token_uq").on(t.tokenHash), index("report_shares_report_idx").on(t.reportId)]);

export const dataExports = pgTable("data_exports", {
  id: id(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["gdpr_user", "organization", "project_csv"] }).notNull(),
  status: text("status", { enum: ["queued", "generating", "ready", "failed", "expired"] }).notNull().default("queued"),
  storageKey: text("storage_key"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("data_exports_user_idx").on(t.userId)]);

/** Stores the provider/state health used by the admin panel. */
export const providerHealth = pgTable("provider_health", {
  provider: text("provider").primaryKey(),
  status: text("status", { enum: ["healthy", "degraded", "down", "not_configured"] }).notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: updatedAt(),
});

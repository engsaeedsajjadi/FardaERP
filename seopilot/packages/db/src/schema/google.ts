import { pgTable, text, timestamp, integer, real, date, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./_common";
import { projects } from "./projects";
import { organizations } from "./tenancy";
import { users } from "./auth";

export const gscConnections = pgTable("gsc_connections", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  googleAccountEmail: text("google_account_email"),
  siteUrl: text("site_url").notNull(), // sc-domain:example.com or https://www.example.com/
  permissionLevel: text("permission_level"),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  encryptedAccessToken: text("encrypted_access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  status: text("status", { enum: ["connected", "needs_reauth", "disconnected"] }).notNull().default("connected"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  connectedBy: text("connected_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("gsc_connections_project_uq").on(t.projectId)]);

/** Daily GSC rows by dimension set. dimension = query | page | query_page | country | device | search_appearance | date */
export const gscMetrics = pgTable("gsc_metrics", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().references(() => gscConnections.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  dimension: text("dimension").notNull(),
  query: text("query"),
  page: text("page"),
  country: text("country"),
  device: text("device"),
  searchAppearance: text("search_appearance"),
  searchType: text("search_type").notNull().default("web"),
  clicks: integer("clicks").notNull(),
  impressions: integer("impressions").notNull(),
  ctr: real("ctr").notNull(),
  position: real("position").notNull(),
  keyHash: text("key_hash").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("gsc_metrics_key_uq").on(t.projectId, t.date, t.dimension, t.keyHash),
  index("gsc_metrics_project_date_dim_idx").on(t.projectId, t.dimension, t.date),
  index("gsc_metrics_project_query_idx").on(t.projectId, t.query),
  index("gsc_metrics_project_page_idx").on(t.projectId, t.page),
]);

export const ga4Connections = pgTable("ga4_connections", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  googleAccountEmail: text("google_account_email"),
  propertyId: text("property_id").notNull(), // properties/123456
  propertyName: text("property_name"),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  encryptedAccessToken: text("encrypted_access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  status: text("status", { enum: ["connected", "needs_reauth", "disconnected"] }).notNull().default("connected"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  connectedBy: text("connected_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("ga4_connections_project_uq").on(t.projectId)]);

/** dimension = date | landing_page | channel | device | country */
export const ga4Metrics = pgTable("ga4_metrics", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().references(() => ga4Connections.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  dimension: text("dimension").notNull(),
  dimensionValue: text("dimension_value"),
  channelGroup: text("channel_group"),
  users: integer("users").notNull().default(0),
  newUsers: integer("new_users").notNull().default(0),
  sessions: integer("sessions").notNull().default(0),
  engagedSessions: integer("engaged_sessions").notNull().default(0),
  conversions: real("conversions").notNull().default(0),
  revenue: real("revenue"),
  bounceRate: real("bounce_rate"),
  avgSessionDurationSec: real("avg_session_duration_sec"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ga4_metrics_key_uq").on(t.projectId, t.date, t.dimension, t.dimensionValue, t.channelGroup),
  index("ga4_metrics_project_date_idx").on(t.projectId, t.dimension, t.date),
]);

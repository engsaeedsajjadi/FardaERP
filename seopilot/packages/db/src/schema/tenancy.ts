import { pgTable, text, timestamp, boolean, integer, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, deletedAt } from "./_common";
import { users } from "./auth";

export const ORG_ROLES = ["owner", "admin", "manager", "seo_manager", "analyst", "editor", "client", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_KINDS = ["standard", "agency", "client"] as const;

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  kind: text("kind", { enum: ORG_KINDS }).notNull().default("standard"),
  /** For kind = client: the agency that manages it. */
  parentOrganizationId: text("parent_organization_id").references(():AnyPgColumn => organizations.id, { onDelete: "set null" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  timezone: text("timezone").notNull().default("UTC"),
  billingEmail: text("billing_email"),
  stripeCustomerId: text("stripe_customer_id"),
  planCode: text("plan_code").notNull().default("free"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  uniqueIndex("organizations_slug_uq").on(t.slug),
  index("organizations_parent_idx").on(t.parentOrganizationId),
  uniqueIndex("organizations_stripe_customer_uq").on(t.stripeCustomerId),
]);

export const organizationMembers = pgTable("organization_members", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ORG_ROLES }).notNull().default("viewer"),
  /** Optional: restrict a member to specific projects (client users, contractors). Null = all projects. */
  projectIds: jsonb("project_ids").$type<string[] | null>(),
  invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("organization_members_org_user_uq").on(t.organizationId, t.userId),
  index("organization_members_user_idx").on(t.userId),
]);

export const organizationInvitations = pgTable("organization_invitations", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ORG_ROLES }).notNull().default("viewer"),
  projectIds: jsonb("project_ids").$type<string[] | null>(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: text("invited_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("organization_invitations_org_idx").on(t.organizationId), uniqueIndex("organization_invitations_token_uq").on(t.tokenHash)]);

/** Granular permission catalogue (seeded, read-only at runtime). */
export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  category: text("category").notNull(),
});

/** Role -> permission mapping (seeded from packages/auth/src/rbac.ts, editable by platform admin). */
export const rolePermissions = pgTable("role_permissions", {
  role: text("role", { enum: ORG_ROLES }).notNull(),
  permissionKey: text("permission_key").notNull().references(() => permissions.key, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.role, t.permissionKey] })]);

export const apiKeys = pgTable("api_keys", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  /** First 12 chars shown in the UI for identification. */
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  projectIds: jsonb("project_ids").$type<string[] | null>(),
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_org_idx").on(t.organizationId)]);

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorApiKeyId: text("actor_api_key_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt), index("audit_logs_actor_idx").on(t.actorUserId)]);

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  enabledGlobally: boolean("enabled_globally").notNull().default(false),
  /** Percentage rollout 0-100 evaluated by hashing organizationId. */
  rolloutPercent: integer("rollout_percent").notNull().default(0),
  updatedAt: updatedAt(),
});

export const featureFlagOverrides = pgTable("feature_flag_overrides", {
  flagKey: text("flag_key").notNull().references(() => featureFlags.key, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull(),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.flagKey, t.organizationId] })]);

export const whiteLabelSettings = pgTable("white_label_settings", {
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }).primaryKey(),
  companyName: text("company_name"),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  primaryColor: text("primary_color"),
  accentColor: text("accent_color"),
  emailFromName: text("email_from_name"),
  emailFromAddress: text("email_from_address"),
  emailReplyTo: text("email_reply_to"),
  customDomain: text("custom_domain"),
  customDomainVerifiedAt: timestamp("custom_domain_verified_at", { withTimezone: true }),
  customDomainVerificationToken: text("custom_domain_verification_token"),
  reportFooter: text("report_footer"),
  loginTagline: text("login_tagline"),
  hidePoweredBy: boolean("hide_powered_by").notNull().default(false),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("white_label_custom_domain_uq").on(t.customDomain)]);

export const rateLimitCounters = pgTable("rate_limit_counters", {
  key: text("key").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] })]);

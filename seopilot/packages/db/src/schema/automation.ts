import { pgTable, text, timestamp, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./_common";
import { organizations } from "./tenancy";
import { projects } from "./projects";
import { users } from "./auth";

export const JOB_TYPES = [
  "SITE_CRAWL", "RANK_CHECK", "KEYWORD_REFRESH", "BACKLINK_REFRESH", "GSC_SYNC", "GA4_SYNC",
  "PAGESPEED_CHECK", "COMPETITOR_CHECK", "AI_VISIBILITY_CHECK", "REPORT_GENERATION", "ALERT_PROCESSING",
  "WEBHOOK_DELIVERY", "EMAIL_DELIVERY", "DATA_EXPORT", "ORG_DELETION", "SCHEDULE_TICK",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "active", "completed", "failed", "cancelled", "dead"] as const;

/** Application-level job ledger (pg-boss holds the queue mechanics; this is the tenant-visible record). */
export const jobs = pgTable("jobs", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  type: text("type", { enum: JOB_TYPES }).notNull(),
  status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>(),
  /** Deterministic key preventing duplicate concurrent jobs (e.g. one active crawl per project). */
  idempotencyKey: text("idempotency_key"),
  bossJobId: text("boss_job_id"),
  scheduleId: text("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
  priority: integer("priority").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastError: text("last_error"),
  requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("jobs_org_created_idx").on(t.organizationId, t.createdAt),
  index("jobs_project_type_idx").on(t.projectId, t.type),
  index("jobs_status_idx").on(t.status),
  uniqueIndex("jobs_idem_uq").on(t.idempotencyKey),
]);

export const jobAttempts = pgTable("job_attempts", {
  id: id(),
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "restrict" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  workerId: text("worker_id"),
  status: text("status", { enum: ["active", "succeeded", "failed", "timed_out"] }).notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
}, (t) => [index("job_attempts_job_idx").on(t.jobId)]);

export const schedules = pgTable("schedules", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  jobType: text("job_type", { enum: JOB_TYPES }).notNull(),
  name: text("name").notNull(),
  /** hourly | daily | weekly | monthly | custom */
  frequency: text("frequency").notNull(),
  /** 5-field cron expression evaluated in `timezone`. */
  cron: text("cron").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  isEnabled: boolean("is_enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastJobId: text("last_job_id"),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("schedules_next_run_idx").on(t.isEnabled, t.nextRunAt), index("schedules_project_idx").on(t.projectId)]);

export const notificationRules = pgTable("notification_rules", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** rank_drop | rank_gain | clicks_drop | critical_issue | competitor_overtake | backlink_lost | credit_low | crawl_failed | report_ready */
  event: text("event").notNull(),
  /** Event-specific condition e.g. { positions: 5 } or { percent: 20, windowDays: 7 }. */
  condition: jsonb("condition").$type<Record<string, unknown>>().notNull().default({}),
  channels: jsonb("channels").$type<Array<{ type: "email" | "dashboard" | "webhook" | "slack" | "discord" | "telegram"; target?: string }>>().notNull().default([{ type: "dashboard" }]),
  isEnabled: boolean("is_enabled").notNull().default(true),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("notification_rules_org_event_idx").on(t.organizationId, t.event)]);

export const notifications = pgTable("notifications", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }), // null = org-wide
  ruleId: text("rule_id").references(() => notificationRules.id, { onDelete: "set null" }),
  event: text("event").notNull(),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("info"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  deliveries: jsonb("deliveries").$type<Array<{ channel: string; target?: string; status: "sent" | "failed" | "skipped"; error?: string; at: string }>>().notNull().default([]),
  createdAt: createdAt(),
}, (t) => [index("notifications_org_created_idx").on(t.organizationId, t.createdAt), index("notifications_user_unread_idx").on(t.userId, t.readAt)]);

export const webhooks = pgTable("webhooks", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  description: text("description"),
  events: jsonb("events").$type<string[]>().notNull().default([]),
  /** Encrypted signing secret. */
  encryptedSecret: text("encrypted_secret").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  failureCount: integer("failure_count").notNull().default(0),
  disabledReason: text("disabled_reason"),
  lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("webhooks_org_idx").on(t.organizationId)]);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: id(),
  webhookId: text("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  attempt: integer("attempt").notNull().default(1),
  status: text("status", { enum: ["pending", "delivered", "failed", "dead"] }).notNull().default("pending"),
  responseStatus: integer("response_status"),
  responseBodySnippet: text("response_body_snippet"),
  error: text("error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt), index("webhook_deliveries_pending_idx").on(t.status, t.nextAttemptAt)]);

import { pgTable, text, timestamp, integer, real, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./_common";
import { organizations } from "./tenancy";
import { projects } from "./projects";
import { users } from "./auth";
import { jobs } from "./automation";

/** Every AI call, for cost control and audit (spec §28–29). */
export const aiRuns = pgTable("ai_runs", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  feature: text("feature").notNull(), // content.brief | content.meta | geo.visibility | aeo.questions | links.suggest ...
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd"),
  creditsCharged: integer("credits_charged").notNull().default(0),
  latencyMs: integer("latency_ms"),
  providerRequestId: text("provider_request_id"),
  status: text("status", { enum: ["succeeded", "failed", "rejected_budget"] }).notNull(),
  errorMessage: text("error_message"),
  promptStorageKey: text("prompt_storage_key"),
  createdAt: createdAt(),
}, (t) => [index("ai_runs_org_created_idx").on(t.organizationId, t.createdAt), index("ai_runs_project_idx").on(t.projectId)]);

export const contentItems = pgTable("content_items", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["brief", "outline", "titles", "meta", "faq", "improvement", "refresh", "keyword_placement", "topics", "internal_links"] }).notNull(),
  title: text("title").notNull(),
  targetUrl: text("target_url"),
  targetKeywords: jsonb("target_keywords").$type<string[]>().notNull().default([]),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
  qualityChecks: jsonb("quality_checks").$type<Array<{ check: string; passed: boolean; detail: string }>>().notNull().default([]),
  aiRunId: text("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
  status: text("status", { enum: ["draft", "reviewed", "approved", "archived"] }).notNull().default("draft"),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("content_items_project_idx").on(t.projectId, t.createdAt)]);

export const aiVisibilityPrompts = pgTable("ai_visibility_prompts", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  topic: text("topic"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [index("ai_visibility_prompts_project_idx").on(t.projectId)]);

export const aiVisibilityRuns = pgTable("ai_visibility_runs", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  status: text("status", { enum: ["queued", "running", "completed", "failed", "partial"] }).notNull().default("queued"),
  promptCount: integer("prompt_count").notNull().default(0),
  providers: jsonb("providers").$type<string[]>().notNull().default([]),
  /** Aggregates derived purely from measured results. */
  summary: jsonb("summary").$type<Record<string, { brandMentions: number; competitorMentions: number; citations: number; answers: number }>>(),
  costCredits: integer("cost_credits").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("ai_visibility_runs_project_idx").on(t.projectId, t.createdAt)]);

export const aiVisibilityResults = pgTable("ai_visibility_results", {
  id: id(),
  runId: text("run_id").notNull().references(() => aiVisibilityRuns.id, { onDelete: "cascade" }),
  promptId: text("prompt_id").notNull().references(() => aiVisibilityPrompts.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  prompt: text("prompt").notNull(),
  answer: text("answer").notNull(),
  /** Measured: literal string matching against brand/aliases and competitor domains. */
  brandMentioned: boolean("brand_mentioned").notNull(),
  brandMentionCount: integer("brand_mention_count").notNull().default(0),
  competitorMentions: jsonb("competitor_mentions").$type<Array<{ domain: string; count: number }>>().notNull().default([]),
  citations: jsonb("citations").$type<Array<{ url: string; domain: string; isBrand: boolean }>>().notNull().default([]),
  brandCited: boolean("brand_cited").notNull().default(false),
  /** Interpreted (model-generated) fields are labelled as such. */
  sentiment: text("sentiment"),
  sentimentSource: text("sentiment_source"), // "model_interpretation"
  aiRunId: text("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
  providerRequestId: text("provider_request_id"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("ai_visibility_results_run_idx").on(t.runId), index("ai_visibility_results_project_idx").on(t.projectId, t.fetchedAt)]);

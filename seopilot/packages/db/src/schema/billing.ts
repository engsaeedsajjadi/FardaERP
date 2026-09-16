import { pgTable, text, timestamp, integer, boolean, real, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./_common";
import { organizations } from "./tenancy";
import { projects } from "./projects";
import { users } from "./auth";

export interface PlanLimits {
  projects: number;
  keywords: number;
  crawledPagesPerMonth: number;
  rankChecksPerMonth: number;
  aiOperationsPerMonth: number;
  reportsPerMonth: number;
  users: number;
  apiRequestsPerDay: number;
  competitorsPerProject: number;
  clientOrganizations: number;
  whiteLabel: boolean;
  agencyMode: boolean;
  monthlyCredits: number;
}

export const plans = pgTable("plans", {
  code: text("code").primaryKey(), // free | starter | pro | agency | enterprise
  name: text("name").notNull(),
  description: text("description"),
  limits: jsonb("limits").$type<PlanLimits>().notNull(),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  trialDays: integer("trial_days").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  isPublic: boolean("is_public").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: updatedAt(),
});

export const prices = pgTable("prices", {
  id: id(),
  planCode: text("plan_code").notNull().references(() => plans.code),
  stripePriceId: text("stripe_price_id"),
  currency: text("currency").notNull().default("usd"),
  unitAmount: integer("unit_amount").notNull(), // cents
  interval: text("interval", { enum: ["month", "year"] }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("prices_stripe_uq").on(t.stripePriceId), index("prices_plan_idx").on(t.planCode)]);

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planCode: text("plan_code").notNull().references(() => plans.code),
  priceId: text("price_id").references(() => prices.id, { onDelete: "set null" }),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId: text("stripe_customer_id"),
  status: text("status", { enum: ["trialing", "active", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"] }).notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  trialEnd: timestamp("trial_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  /** Grace period end after a failed payment before features are restricted. */
  graceUntil: timestamp("grace_until", { withTimezone: true }),
  seats: integer("seats").notNull().default(1),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("subscriptions_org_idx").on(t.organizationId), uniqueIndex("subscriptions_stripe_uq").on(t.stripeSubscriptionId)]);

export const invoices = pgTable("invoices", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  subscriptionId: text("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  stripeInvoiceId: text("stripe_invoice_id").notNull(),
  number: text("number"),
  status: text("status").notNull(),
  currency: text("currency").notNull(),
  amountDue: integer("amount_due").notNull(),
  amountPaid: integer("amount_paid").notNull().default(0),
  hostedInvoiceUrl: text("hosted_invoice_url"),
  invoicePdfUrl: text("invoice_pdf_url"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  dueDate: timestamp("due_date", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("invoices_stripe_uq").on(t.stripeInvoiceId), index("invoices_org_idx").on(t.organizationId, t.createdAt)]);

export const payments = pgTable("payments", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  invoiceId: text("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeChargeId: text("stripe_charge_id"),
  status: text("status").notNull(),
  currency: text("currency").notNull(),
  amount: integer("amount").notNull(),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("payments_pi_uq").on(t.stripePaymentIntentId), index("payments_org_idx").on(t.organizationId)]);

export const coupons = pgTable("coupons", {
  id: id(),
  code: text("code").notNull(),
  stripeCouponId: text("stripe_coupon_id"),
  stripePromotionCodeId: text("stripe_promotion_code_id"),
  percentOff: real("percent_off"),
  amountOff: integer("amount_off"),
  currency: text("currency"),
  duration: text("duration"),
  maxRedemptions: integer("max_redemptions"),
  redeemedCount: integer("redeemed_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("coupons_code_uq").on(t.code)]);

/** Raw Stripe events for idempotent, replayable reconciliation. */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(), // evt_...
  type: text("type").notNull(),
  apiVersion: text("api_version"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processingError: text("processing_error"),
  receivedAt: createdAt(),
}, (t) => [index("stripe_events_type_idx").on(t.type, t.receivedAt)]);

export const creditWallets = pgTable("credit_wallets", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  /** Soft-limit for alerts (credit.low webhook / email). */
  lowBalanceThreshold: integer("low_balance_threshold").notNull().default(100),
  lowBalanceNotifiedAt: timestamp("low_balance_notified_at", { withTimezone: true }),
  /** Hard cap on AI spend per calendar month in credits (0 = plan default). */
  monthlyAiCap: integer("monthly_ai_cap").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("credit_wallets_org_uq").on(t.organizationId)]);

export const CREDIT_TX_KINDS = ["grant", "consumption", "refund", "expiry", "adjustment", "purchase"] as const;

export const creditTransactions = pgTable("credit_transactions", {
  id: id(),
  walletId: text("wallet_id").notNull().references(() => creditWallets.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: CREDIT_TX_KINDS }).notNull(),
  /** Positive for grants/refunds, negative for consumption. */
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  operation: text("operation"), // serp.check | keyword.ideas | backlinks.summary | ai.content.brief | crawl.page ...
  provider: text("provider"),
  quantity: integer("quantity"),
  /** Provider cost in USD when known (DataForSEO returns `cost` per task). */
  providerCostUsd: real("provider_cost_usd"),
  referenceType: text("reference_type"), // job | ai_run | serp_result | grant | stripe_invoice
  referenceId: text("reference_id"),
  /** Prevents double-charging on retries. */
  idempotencyKey: text("idempotency_key"),
  note: text("note"),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("credit_transactions_wallet_created_idx").on(t.walletId, t.createdAt),
  index("credit_transactions_org_created_idx").on(t.organizationId, t.createdAt),
  uniqueIndex("credit_transactions_idem_uq").on(t.idempotencyKey),
]);

export const USAGE_METRICS = ["crawl_pages", "serp_calls", "keyword_calls", "backlink_calls", "ai_tokens_in", "ai_tokens_out", "ai_requests", "reports", "api_calls", "rank_checks", "pagespeed_calls", "gsc_syncs", "ga4_syncs", "ai_visibility_prompts"] as const;

/** Hourly-bucketed usage counters; dashboards aggregate by period. */
export const usageRecords = pgTable("usage_records", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  metric: text("metric", { enum: USAGE_METRICS }).notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(), // hour bucket
  quantity: integer("quantity").notNull().default(0),
  provider: text("provider"),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("usage_records_bucket_uq").on(t.organizationId, t.projectId, t.metric, t.periodStart, t.provider),
  index("usage_records_org_metric_period_idx").on(t.organizationId, t.metric, t.periodStart),
]);

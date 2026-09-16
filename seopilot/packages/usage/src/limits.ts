/**
 * Plan limit enforcement. Limits come from the `plans` table (seeded by
 * migration, editable by the admin panel) — never hardcoded per tenant.
 */
import { and, count, eq, isNull, schema, type Transaction } from "@seopilot/db";
import { AppError } from "@seopilot/shared";
import { startOfMonthUtc, usageTotal, type UsageMetric } from "./usage";

export type PlanLimits = schema.PlanLimits;

export async function getPlanForOrganization(tx: Transaction, organizationId: string): Promise<{ code: string; name: string; limits: PlanLimits; features: string[]; subscriptionStatus: string | null; graceUntil: Date | null }> {
  const [org] = await tx.select({ planCode: schema.organizations.planCode }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
  if (!org) throw new AppError("NOT_FOUND", "Organization not found");
  const [plan] = await tx.select().from(schema.plans).where(eq(schema.plans.code, org.planCode)).limit(1);
  if (!plan) throw new AppError("INTERNAL_ERROR", `Plan ${org.planCode} is not defined`, { planCode: org.planCode });
  const [sub] = await tx.select({ status: schema.subscriptions.status, graceUntil: schema.subscriptions.graceUntil }).from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, organizationId)).orderBy(schema.subscriptions.createdAt).limit(1);
  return { code: plan.code, name: plan.name, limits: plan.limits, features: plan.features, subscriptionStatus: sub?.status ?? null, graceUntil: sub?.graceUntil ?? null };
}

export function planAllows(features: string[], feature: string): boolean {
  return features.includes(feature);
}

export function assertFeature(plan: { code: string; features: string[] }, feature: string): void {
  if (!planAllows(plan.features, feature)) {
    throw new AppError("PLAN_LIMIT_REACHED", `The ${plan.code} plan does not include ${feature.replace(/_/g, " ")}.`, { feature, planCode: plan.code, upgradeRequired: true }, { reportable: false });
  }
}

/** Static count limits (projects, keywords, users, competitors). */
export async function assertCountLimit(tx: Transaction, organizationId: string, kind: "projects" | "keywords" | "users" | "competitorsPerProject" | "clientOrganizations", opts: { projectId?: string; adding?: number } = {}): Promise<{ used: number; limit: number }> {
  const plan = await getPlanForOrganization(tx, organizationId);
  const limit = plan.limits[kind];
  let used = 0;
  switch (kind) {
    case "projects": {
      const [r] = await tx.select({ n: count() }).from(schema.projects).where(and(eq(schema.projects.organizationId, organizationId), isNull(schema.projects.deletedAt)));
      used = Number(r?.n ?? 0);
      break;
    }
    case "keywords": {
      const [r] = await tx.select({ n: count() }).from(schema.keywords).where(and(eq(schema.keywords.organizationId, organizationId), eq(schema.keywords.isTracked, true)));
      used = Number(r?.n ?? 0);
      break;
    }
    case "users": {
      const [r] = await tx.select({ n: count() }).from(schema.organizationMembers).where(eq(schema.organizationMembers.organizationId, organizationId));
      used = Number(r?.n ?? 0);
      break;
    }
    case "competitorsPerProject": {
      if (!opts.projectId) throw new AppError("VALIDATION_ERROR", "projectId required for competitor limit");
      const [r] = await tx.select({ n: count() }).from(schema.competitors).where(eq(schema.competitors.projectId, opts.projectId));
      used = Number(r?.n ?? 0);
      break;
    }
    case "clientOrganizations": {
      const [r] = await tx.select({ n: count() }).from(schema.organizations).where(and(eq(schema.organizations.parentOrganizationId, organizationId), isNull(schema.organizations.deletedAt)));
      used = Number(r?.n ?? 0);
      break;
    }
  }
  const adding = opts.adding ?? 1;
  if (used + adding > limit) {
    throw new AppError("PLAN_LIMIT_REACHED", `Your ${plan.name} plan allows ${limit} ${kind === "competitorsPerProject" ? "competitors per project" : kind}. You are using ${used}.`, { kind, used, limit, planCode: plan.code, upgradeRequired: true }, { reportable: false });
  }
  return { used, limit };
}

const MONTHLY: Partial<Record<UsageMetric, keyof PlanLimits>> = {
  crawl_pages: "crawledPagesPerMonth",
  rank_checks: "rankChecksPerMonth",
  ai_requests: "aiOperationsPerMonth",
  reports: "reportsPerMonth",
};

/** Monthly metered limits (crawled pages, rank checks, AI ops, reports). Returns remaining quota. */
export async function assertMonthlyLimit(tx: Transaction, organizationId: string, metric: UsageMetric, adding = 1): Promise<{ used: number; limit: number; remaining: number }> {
  const key = MONTHLY[metric];
  if (!key) return { used: 0, limit: Number.POSITIVE_INFINITY, remaining: Number.POSITIVE_INFINITY };
  const plan = await getPlanForOrganization(tx, organizationId);
  const limit = Number(plan.limits[key]);
  const used = await usageTotal(tx, organizationId, metric, startOfMonthUtc());
  if (used + adding > limit) {
    throw new AppError("PLAN_LIMIT_REACHED", `Monthly limit reached: ${used}/${limit} ${metric.replace(/_/g, " ")} on the ${plan.name} plan.`, { metric, used, limit, planCode: plan.code, upgradeRequired: true }, { reportable: false });
  }
  return { used, limit, remaining: limit - used - adding };
}

/** Daily API request limit check (used by the REST API middleware together with the sliding-window rate limiter). */
export async function apiRequestsRemainingToday(tx: Transaction, organizationId: string): Promise<{ used: number; limit: number }> {
  const plan = await getPlanForOrganization(tx, organizationId);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const used = await usageTotal(tx, organizationId, "api_calls", start);
  return { used, limit: plan.limits.apiRequestsPerDay };
}

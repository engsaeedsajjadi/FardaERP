/** Hourly usage counters (separate from credits: they track plan limits like crawled pages/month). */
import { and, eq, gte, isNull, lt, schema, sql, type Transaction } from "@seopilot/db";

export type UsageMetric = (typeof schema.USAGE_METRICS)[number];

export function hourBucket(d = new Date()): Date {
  const b = new Date(d);
  b.setUTCMinutes(0, 0, 0);
  return b;
}

export async function recordUsage(tx: Transaction, input: { organizationId: string; projectId?: string | null; metric: UsageMetric; quantity: number; provider?: string | null; at?: Date }): Promise<void> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return;
  const bucket = hourBucket(input.at);
  await tx.execute(sql`
    INSERT INTO usage_records (id, organization_id, project_id, metric, period_start, quantity, provider, updated_at)
    VALUES (gen_random_uuid()::text, ${input.organizationId}, ${input.projectId ?? null}, ${input.metric}, ${bucket}, ${Math.round(input.quantity)}, ${input.provider ?? null}, now())
    ON CONFLICT (organization_id, project_id, metric, period_start, provider)
    DO UPDATE SET quantity = usage_records.quantity + EXCLUDED.quantity, updated_at = now()`);
}

export async function usageTotal(tx: Transaction, organizationId: string, metric: UsageMetric, from: Date, to = new Date(), projectId?: string | null): Promise<number> {
  const conds = [eq(schema.usageRecords.organizationId, organizationId), eq(schema.usageRecords.metric, metric), gte(schema.usageRecords.periodStart, from), lt(schema.usageRecords.periodStart, to)];
  if (projectId !== undefined) conds.push(projectId === null ? isNull(schema.usageRecords.projectId) : eq(schema.usageRecords.projectId, projectId));
  const [row] = await tx.select({ total: sql<number>`COALESCE(SUM(${schema.usageRecords.quantity}), 0)::int` }).from(schema.usageRecords).where(and(...conds));
  return Number(row?.total ?? 0);
}

export async function usageBreakdown(tx: Transaction, organizationId: string, from: Date, to = new Date()): Promise<Record<string, number>> {
  const rows = await tx
    .select({ metric: schema.usageRecords.metric, total: sql<number>`SUM(${schema.usageRecords.quantity})::int` })
    .from(schema.usageRecords)
    .where(and(eq(schema.usageRecords.organizationId, organizationId), gte(schema.usageRecords.periodStart, from), lt(schema.usageRecords.periodStart, to)))
    .groupBy(schema.usageRecords.metric);
  return Object.fromEntries(rows.map((r) => [r.metric, Number(r.total)]));
}

export function startOfMonthUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

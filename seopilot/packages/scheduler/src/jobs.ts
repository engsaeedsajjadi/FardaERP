/**
 * Application job ledger over pg-boss. The `jobs` table is the tenant-visible
 * record (RLS-protected); pg-boss (schema `pgboss`) only holds the queue.
 * Enqueue is idempotent per `idempotencyKey` (e.g. one active crawl per project).
 */
import { and, eq, inArray, schema, sql, type Transaction } from "@seopilot/db";
import { AppError } from "@seopilot/shared";
import type { SendOptions } from "pg-boss";

export type JobType = schema.JobType;

export const QUEUE_PREFIX = "seopilot";
export const queueName = (t: JobType) => `${QUEUE_PREFIX}.${t.toLowerCase()}`;

/** Per-type pg-boss options (retry/expiry). */
export const JOB_POLICY: Record<JobType, { retryLimit: number; retryDelaySec: number; expireInSeconds: number; singletonKeyed: boolean }> = {
  SITE_CRAWL: { retryLimit: 1, retryDelaySec: 300, expireInSeconds: 3 * 3600, singletonKeyed: true },
  RANK_CHECK: { retryLimit: 2, retryDelaySec: 120, expireInSeconds: 2 * 3600, singletonKeyed: true },
  KEYWORD_REFRESH: { retryLimit: 2, retryDelaySec: 120, expireInSeconds: 1800, singletonKeyed: true },
  BACKLINK_REFRESH: { retryLimit: 2, retryDelaySec: 300, expireInSeconds: 1800, singletonKeyed: true },
  GSC_SYNC: { retryLimit: 3, retryDelaySec: 300, expireInSeconds: 1800, singletonKeyed: true },
  GA4_SYNC: { retryLimit: 3, retryDelaySec: 300, expireInSeconds: 1800, singletonKeyed: true },
  PAGESPEED_CHECK: { retryLimit: 2, retryDelaySec: 60, expireInSeconds: 900, singletonKeyed: false },
  COMPETITOR_CHECK: { retryLimit: 2, retryDelaySec: 300, expireInSeconds: 1800, singletonKeyed: true },
  AI_VISIBILITY_CHECK: { retryLimit: 1, retryDelaySec: 300, expireInSeconds: 3600, singletonKeyed: true },
  REPORT_GENERATION: { retryLimit: 2, retryDelaySec: 60, expireInSeconds: 900, singletonKeyed: false },
  ALERT_PROCESSING: { retryLimit: 2, retryDelaySec: 60, expireInSeconds: 600, singletonKeyed: true },
  WEBHOOK_DELIVERY: { retryLimit: 5, retryDelaySec: 60, expireInSeconds: 120, singletonKeyed: false },
  EMAIL_DELIVERY: { retryLimit: 3, retryDelaySec: 60, expireInSeconds: 120, singletonKeyed: false },
  DATA_EXPORT: { retryLimit: 1, retryDelaySec: 300, expireInSeconds: 3600, singletonKeyed: true },
  ORG_DELETION: { retryLimit: 3, retryDelaySec: 3600, expireInSeconds: 3600, singletonKeyed: true },
  SCHEDULE_TICK: { retryLimit: 0, retryDelaySec: 0, expireInSeconds: 300, singletonKeyed: true },
};

/** Multiplier for retry delays (JOB_RETRY_DELAY_SCALE=0 makes retries immediate in tests). */
export function retryDelayFor(type: JobType, env: NodeJS.ProcessEnv = process.env): number {
  const scale = env.JOB_RETRY_DELAY_SCALE === undefined ? 1 : Number(env.JOB_RETRY_DELAY_SCALE);
  return Math.round(JOB_POLICY[type].retryDelaySec * (Number.isFinite(scale) ? scale : 1));
}

export interface EnqueueInput {
  organizationId: string;
  projectId?: string | null;
  type: JobType;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  priority?: number;
  requestedBy?: string | null;
  scheduleId?: string | null;
  startAfter?: Date;
}

export interface BossLike {
  send(name: string, data: object, options?: SendOptions): Promise<string | null>;
}

/** Default idempotency key: one queued/active job of this type per project (or org). */
export function defaultIdempotencyKey(input: Pick<EnqueueInput, "organizationId" | "projectId" | "type">): string {
  return `${input.type}:${input.projectId ?? input.organizationId}`;
}

/**
 * Insert the ledger row (inside the caller's tenant tx) and hand the job to
 * pg-boss. Returns { job, created:false } when an equivalent job is already
 * queued/active. The boss job id is stored after send for traceability.
 */
export async function enqueueJob(tx: Transaction, boss: BossLike, input: EnqueueInput): Promise<{ jobId: string; created: boolean }> {
  const key = input.idempotencyKey === null ? null : (input.idempotencyKey ?? (JOB_POLICY[input.type].singletonKeyed ? defaultIdempotencyKey(input) : null));
  if (key) {
    const [existing] = await tx.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.idempotencyKey, key), inArray(schema.jobs.status, ["queued", "active"]))).limit(1);
    if (existing) return { jobId: existing.id, created: false };
    // Release the key from finished jobs so the same logical job can run again.
    await tx.update(schema.jobs).set({ idempotencyKey: null }).where(and(eq(schema.jobs.idempotencyKey, key), inArray(schema.jobs.status, ["completed", "failed", "cancelled", "dead"])));
  }
  const policy = JOB_POLICY[input.type];
  const [row] = await tx
    .insert(schema.jobs)
    .values({ organizationId: input.organizationId, projectId: input.projectId ?? null, type: input.type, payload: input.payload ?? {}, idempotencyKey: key, priority: input.priority ?? 0, maxAttempts: policy.retryLimit + 1, requestedBy: input.requestedBy ?? null, scheduleId: input.scheduleId ?? null, scheduledFor: input.startAfter ?? null })
    .returning({ id: schema.jobs.id });
  const jobId = row!.id;
  const bossId = await boss.send(queueName(input.type), { jobId, organizationId: input.organizationId, projectId: input.projectId ?? null, ...input.payload }, { retryLimit: policy.retryLimit, retryDelay: retryDelayFor(input.type), retryBackoff: retryDelayFor(input.type) > 0, expireInSeconds: policy.expireInSeconds, priority: input.priority ?? 0, startAfter: input.startAfter, singletonKey: key ?? undefined });
  if (!bossId) throw new AppError("INTERNAL_ERROR", "Queue rejected the job", { type: input.type });
  await tx.update(schema.jobs).set({ bossJobId: bossId }).where(eq(schema.jobs.id, jobId));
  return { jobId, created: true };
}

export async function markJobActive(tx: Transaction, jobId: string, workerId: string): Promise<{ attempt: number; attemptId: string }> {
  const [job] = await tx.update(schema.jobs).set({ status: "active", attempts: sql`${schema.jobs.attempts} + 1`, startedAt: sql`COALESCE(${schema.jobs.startedAt}, now())`, updatedAt: new Date() }).where(eq(schema.jobs.id, jobId)).returning({ attempts: schema.jobs.attempts, organizationId: schema.jobs.organizationId });
  if (!job) throw new AppError("NOT_FOUND", `job ${jobId} not found`);
  const [a] = await tx.insert(schema.jobAttempts).values({ jobId, organizationId: job.organizationId, attempt: job.attempts, workerId, status: "active" }).returning({ id: schema.jobAttempts.id });
  return { attempt: job.attempts, attemptId: a!.id };
}

export async function markJobFinished(tx: Transaction, jobId: string, attemptId: string, outcome: { ok: true; result?: Record<string, unknown> } | { ok: false; error: string; final: boolean }): Promise<void> {
  const now = new Date();
  const [a] = await tx.select({ startedAt: schema.jobAttempts.startedAt }).from(schema.jobAttempts).where(eq(schema.jobAttempts.id, attemptId));
  const durationMs = a ? now.getTime() - a.startedAt.getTime() : null;
  if (outcome.ok) {
    await tx.update(schema.jobAttempts).set({ status: "succeeded", finishedAt: now, durationMs }).where(eq(schema.jobAttempts.id, attemptId));
    await tx.update(schema.jobs).set({ status: "completed", result: outcome.result ?? {}, finishedAt: now, lastError: null, updatedAt: now }).where(eq(schema.jobs.id, jobId));
  } else {
    await tx.update(schema.jobAttempts).set({ status: "failed", error: outcome.error.slice(0, 2000), finishedAt: now, durationMs }).where(eq(schema.jobAttempts.id, attemptId));
    await tx.update(schema.jobs).set({ status: outcome.final ? "failed" : "queued", lastError: outcome.error.slice(0, 2000), finishedAt: outcome.final ? now : null, updatedAt: now }).where(eq(schema.jobs.id, jobId));
  }
}

export async function cancelJob(tx: Transaction, jobId: string): Promise<boolean> {
  const rows = await tx.update(schema.jobs).set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.jobs.id, jobId), inArray(schema.jobs.status, ["queued", "active"]))).returning({ id: schema.jobs.id });
  return rows.length > 0;
}

export async function getJob(tx: Transaction, jobId: string) {
  const [j] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1);
  return j ?? null;
}

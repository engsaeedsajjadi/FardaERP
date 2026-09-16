/**
 * Worker runtime: binds pg-boss queues to handlers, keeps the tenant-visible
 * `jobs` ledger in sync, scopes every DB access to the job's organization via
 * withSystem (RLS stays on), and turns handler errors into retries / final
 * failures. One pg-boss instance, one queue per job type, concurrency from env.
 */
import { randomUUID } from "node:crypto";
import { PgBoss, type JobWithMetadata } from "pg-boss";
import { getPool, schema, withSystem } from "@seopilot/db";
import { enqueueJob, JOB_POLICY, markJobActive, markJobFinished, queueName, retryDelayFor, runDueSchedules } from "@seopilot/scheduler";
import { AppError, logger } from "@seopilot/shared";
import type { HandlerContext, JobEnvelope, JobHandler } from "./types";

export interface WorkerOptions {
  concurrency: number;
  workerId?: string;
  env?: NodeJS.ProcessEnv;
  /** Override for tests. */
  handlers?: Partial<Record<schema.JobType, JobHandler>>;
}

/** Errors that must never be retried: the input is wrong or the account cannot proceed. */
const NON_RETRYABLE = new Set(["VALIDATION_ERROR", "NOT_FOUND", "PROVIDER_NOT_CONFIGURED", "INSUFFICIENT_CREDITS", "PLAN_LIMIT_REACHED", "FORBIDDEN"]);

export function createBoss(connectionString = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL): PgBoss {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PgBoss({ connectionString, schema: "pgboss", application_name: "seopilot-worker", max: 4, superviseIntervalSeconds: 60, maintenanceIntervalSeconds: 300 });
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const type of schema.JOB_TYPES) {
    const policy = JOB_POLICY[type];
    await boss.createQueue(`${queueName(type)}.dead`, { policy: "standard" });
    await boss.createQueue(queueName(type), { policy: "standard", retryLimit: policy.retryLimit, retryDelay: retryDelayFor(type), retryBackoff: retryDelayFor(type) > 0, expireInSeconds: policy.expireInSeconds, deadLetter: `${queueName(type)}.dead` });
  }
}

export function wrapHandler(type: schema.JobType, handler: JobHandler, boss: PgBoss, opts: { workerId: string; env: NodeJS.ProcessEnv }) {
  return async (jobs: JobWithMetadata<JobEnvelope>[]) => {
    for (const job of jobs) {
      const p = job.data;
      const log = logger.child({ jobType: type, jobId: p.jobId, bossJobId: job.id, organizationId: p.organizationId, projectId: p.projectId ?? undefined, workerId: opts.workerId });
      const attemptInfo = await withSystem(p.organizationId, (tx) => markJobActive(tx, p.jobId, opts.workerId)).catch((err: unknown) => {
        log.error({ err: err instanceof Error ? err.message : String(err) }, "job.ledger_missing");
        return null;
      });
      if (!attemptInfo) return; // ledger row gone (org deleted) — drop silently
      const ctx: HandlerContext = {
        tx: (fn) => withSystem(p.organizationId, fn),
        log, signal: job.signal, workerId: opts.workerId, attempt: attemptInfo.attempt, bossJobId: job.id, env: opts.env,
        enqueue: async (input) => (await withSystem(input.organizationId, (tx) => enqueueJob(tx, boss, { ...input, payload: { ...input.payload, parentJobId: p.jobId } }))).jobId,
      };
      const started = Date.now();
      try {
        const result = await handler(p, ctx);
        await withSystem(p.organizationId, (tx) => markJobFinished(tx, p.jobId, attemptInfo.attemptId, { ok: true, result }));
        log.info({ durationMs: Date.now() - started, result }, "job.completed");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const nonRetryable = err instanceof AppError && NON_RETRYABLE.has(err.code);
        const final = nonRetryable || job.retryCount >= job.retryLimit;
        await withSystem(p.organizationId, (tx) => markJobFinished(tx, p.jobId, attemptInfo.attemptId, { ok: false, error: message, final }));
        log[final ? "error" : "warn"]({ durationMs: Date.now() - started, err: message, retryCount: job.retryCount, retryLimit: job.retryLimit, final }, final ? "job.failed" : "job.retry");
        if (nonRetryable) continue; // ack to pg-boss; ledger already says failed
        throw err; // pg-boss retries or dead-letters
      }
    }
  };
}

export async function startWorker(boss: PgBoss, handlers: Record<schema.JobType, JobHandler>, opts: WorkerOptions): Promise<{ stop: () => Promise<void> }> {
  const workerId = opts.workerId ?? `${process.env.HOSTNAME ?? "worker"}-${randomUUID().slice(0, 8)}`;
  const env = opts.env ?? process.env;
  await boss.start();
  await ensureQueues(boss);
  const heavy: schema.JobType[] = ["SITE_CRAWL", "AI_VISIBILITY_CHECK", "REPORT_GENERATION", "DATA_EXPORT"];
  for (const type of schema.JOB_TYPES) {
    const handler = handlers[type];
    const teamSize = heavy.includes(type) ? Math.max(1, Math.floor(opts.concurrency / 2)) : opts.concurrency;
    await boss.work<JobEnvelope>(queueName(type), { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: type === "SCHEDULE_TICK" ? 5 : 2, localConcurrency: teamSize }, wrapHandler(type, handler, boss, { workerId, env }) as never);
  }
  // Scheduler tick: a singleton cron job owned by pg-boss (deduplicated across worker replicas).
  await boss.schedule(queueName("SCHEDULE_TICK"), "* * * * *", { jobId: "schedule-tick", organizationId: "system", projectId: null }, { singletonKey: "schedule-tick" });
  logger.info({ workerId, concurrency: opts.concurrency, queues: schema.JOB_TYPES.length }, "worker.started");
  return {
    stop: async () => {
      await boss.stop({ graceful: true, timeout: 30_000, close: true });
      await getPool().end().catch(() => undefined);
      logger.info({ workerId }, "worker.stopped");
    },
  };
}

/** SCHEDULE_TICK has no tenant; it runs the cross-tenant due-schedule scan. */
export function scheduleTickHandler(boss: PgBoss) {
  return async (jobs: Array<{ id: string }>) => {
    for (const _job of jobs) {
      const r = await withSystem(null, (tx) => runDueSchedules(tx, boss));
      if (r.enqueued || r.skipped) logger.info(r, "schedule.tick");
    }
  };
}

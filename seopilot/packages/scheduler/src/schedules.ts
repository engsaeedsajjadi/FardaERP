import { and, eq, lte, schema, type Transaction } from "@seopilot/db";
import { AppError } from "@seopilot/shared";
import { nextRun, validateCron } from "./cron";
import { enqueueJob, type BossLike, type JobType } from "./jobs";

export interface CreateScheduleInput {
  organizationId: string;
  projectId?: string | null;
  jobType: JobType;
  name: string;
  frequency: string;
  cron: string;
  timezone?: string;
  payload?: Record<string, unknown>;
  createdBy: string;
}

export async function createSchedule(tx: Transaction, input: CreateScheduleInput) {
  const timezone = input.timezone ?? "UTC";
  validateCron(input.cron, timezone);
  const next = nextRun(input.cron, timezone);
  if (!next) throw new AppError("VALIDATION_ERROR", "Cron expression never fires");
  const [row] = await tx.insert(schema.schedules).values({ organizationId: input.organizationId, projectId: input.projectId ?? null, jobType: input.jobType, name: input.name, frequency: input.frequency, cron: input.cron, timezone, payload: input.payload ?? {}, nextRunAt: next, createdBy: input.createdBy }).returning();
  return row!;
}

export async function updateSchedule(tx: Transaction, id: string, patch: Partial<Pick<CreateScheduleInput, "name" | "frequency" | "cron" | "timezone" | "payload">> & { isEnabled?: boolean }) {
  const [cur] = await tx.select().from(schema.schedules).where(eq(schema.schedules.id, id)).limit(1);
  if (!cur) throw new AppError("NOT_FOUND", "Schedule not found");
  const cron = patch.cron ?? cur.cron, timezone = patch.timezone ?? cur.timezone;
  validateCron(cron, timezone);
  const [row] = await tx.update(schema.schedules).set({ ...patch, cron, timezone, nextRunAt: nextRun(cron, timezone), updatedAt: new Date() }).where(eq(schema.schedules.id, id)).returning();
  return row!;
}

/**
 * Enqueue every due schedule (system context — runs across tenants) and advance
 * nextRunAt. Skips schedules whose previous job is still queued/active via the
 * job idempotency key; catch-up is a single run, never a burst.
 */
export async function runDueSchedules(tx: Transaction, boss: BossLike, now = new Date()): Promise<{ enqueued: number; skipped: number }> {
  const due = await tx.select().from(schema.schedules).where(and(eq(schema.schedules.isEnabled, true), lte(schema.schedules.nextRunAt, now))).limit(500);
  let enqueued = 0, skipped = 0;
  for (const s of due) {
    const { jobId, created } = await enqueueJob(tx, boss, { organizationId: s.organizationId, projectId: s.projectId, type: s.jobType, payload: { ...s.payload, scheduleId: s.id }, scheduleId: s.id });
    if (created) enqueued++;
    else skipped++;
    await tx.update(schema.schedules).set({ lastRunAt: now, lastJobId: jobId, nextRunAt: nextRun(s.cron, s.timezone, now), updatedAt: now }).where(eq(schema.schedules.id, s.id));
  }
  return { enqueued, skipped };
}

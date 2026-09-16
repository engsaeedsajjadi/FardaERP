import type { Transaction } from "@seopilot/db";
import type { logger } from "@seopilot/shared";
type Logger = typeof logger;

export interface JobEnvelope {
  jobId: string;
  organizationId: string;
  projectId: string | null;
  [k: string]: unknown;
}

export interface HandlerContext {
  /** Run a system-context transaction scoped to the job's organization (RLS on). */
  tx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  log: Logger;
  signal: AbortSignal;
  workerId: string;
  attempt: number;
  bossJobId: string;
  env: NodeJS.ProcessEnv;
  /** Enqueue a follow-up job (e.g. crawl → alert processing). */
  enqueue(input: { type: import("@seopilot/db").schema.JobType; organizationId: string; projectId?: string | null; payload?: Record<string, unknown>; idempotencyKey?: string | null }): Promise<string>;
}

export type JobHandler<P extends JobEnvelope = JobEnvelope> = (payload: P, ctx: HandlerContext) => Promise<Record<string, unknown>>;

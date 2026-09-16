import { and, eq, schema } from "@seopilot/db";
import { requireProvider } from "@seopilot/providers";
import { checkKeywordRank, createRankCheckRun, finishRankCheckRun } from "@seopilot/rankings";
import { AppError } from "@seopilot/shared";
import type { JobEnvelope, JobHandler } from "../types";

interface RankPayload extends JobEnvelope { keywordIds?: string[]; triggeredBy?: string }

export const rankCheck: JobHandler<RankPayload> = async (p, ctx) => {
  if (!p.projectId) throw new Error("RANK_CHECK requires projectId");
  const serp = requireProvider("serp");
  const { runId, keywords, domain } = await ctx.tx(async (tx) => {
    const [project] = await tx.select({ domain: schema.projects.domain }).from(schema.projects).where(eq(schema.projects.id, p.projectId!)).limit(1);
    if (!project) throw new AppError("NOT_FOUND", "Project not found");
    const rows = await tx.select({ id: schema.keywords.id }).from(schema.keywords).where(and(eq(schema.keywords.projectId, p.projectId!), eq(schema.keywords.isTracked, true)));
    const ids = p.keywordIds?.length ? rows.filter((r) => p.keywordIds!.includes(r.id)).map((r) => r.id) : rows.map((r) => r.id);
    const runId = await createRankCheckRun(tx, { projectId: p.projectId!, organizationId: p.organizationId, jobId: p.jobId, keywordCount: ids.length, provider: serp.name, triggeredBy: p.triggeredBy ?? "schedule" });
    return { runId, keywords: ids, domain: project.domain };
  });
  let checked = 0, failed = 0, drops = 0;
  let lastError: string | null = null;
  for (const keywordId of keywords) {
    if (ctx.signal.aborted) break;
    try {
      const r = await ctx.tx((tx) => checkKeywordRank(tx, serp, { runId, keywordId, projectDomain: domain, jobId: p.jobId }));
      checked++;
      if (r.delta !== null && r.delta < 0) drops++;
    } catch (err) {
      failed++;
      lastError = err instanceof Error ? err.message : String(err);
      ctx.log.warn({ keywordId, err: lastError }, "rank.keyword_failed");
      if (err instanceof AppError && (err.code === "INSUFFICIENT_CREDITS" || err.code === "PLAN_LIMIT_REACHED" || err.code === "PROVIDER_AUTH_FAILED")) break; // stop burning attempts
    }
  }
  await ctx.tx((tx) => finishRankCheckRun(tx, runId, { checked, failed, costCredits: checked, error: lastError }));
  if (checked > 0) await ctx.enqueue({ type: "ALERT_PROCESSING", organizationId: p.organizationId, payload: { reason: "rank_check", rankCheckRunId: runId } });
  return { rankCheckRunId: runId, checked, failed, drops };
};

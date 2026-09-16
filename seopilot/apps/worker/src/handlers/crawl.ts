import { eq, schema } from "@seopilot/db";
import { createCrawlRun, executeCrawlRun, failCrawlRun } from "@seopilot/seo";
import { readEnv, workerEnvSchema } from "@seopilot/shared";
import type { JobEnvelope, JobHandler } from "../types";

interface CrawlPayload extends JobEnvelope { crawlRunId?: string; triggeredBy?: string; overrides?: Record<string, unknown> }

export const siteCrawl: JobHandler<CrawlPayload> = async (p, ctx) => {
  if (!p.projectId) throw new Error("SITE_CRAWL requires projectId");
  const env = readEnv(workerEnvSchema, ctx.env);
  const { run, options, project } = await ctx.tx(async (tx) => {
    if (p.crawlRunId) {
      const [existing] = await tx.select().from(schema.crawlRuns).where(eq(schema.crawlRuns.id, p.crawlRunId)).limit(1);
      if (existing && existing.status === "queued") {
        const [proj] = await tx.select().from(schema.projects).where(eq(schema.projects.id, existing.projectId)).limit(1);
        return { run: existing, options: existing.config as Record<string, unknown>, project: proj! };
      }
    }
    return createCrawlRun(tx, { projectId: p.projectId!, organizationId: p.organizationId, jobId: p.jobId, triggeredBy: p.triggeredBy ?? "schedule", overrides: p.overrides as never });
  });
  ctx.log.info({ crawlRunId: run.id, startUrl: run.startUrl }, "crawl.start");
  try {
    const o = options as { maxPages: number; maxDepth: number; concurrency: number; delayMs: number; respectRobots: boolean; renderJavaScript: boolean; userAgent: string | null; includePatterns: string[]; excludePatterns: string[]; followExternalLinksForStatus: boolean; allowHosts?: string[]; allowPorts?: number[] };
    const result = await executeCrawlRun({
      runId: run.id, organizationId: p.organizationId, projectId: project.id, signal: ctx.signal,
      options: { startUrl: run.startUrl, maxPages: o.maxPages, maxDepth: o.maxDepth, concurrency: Math.min(o.concurrency, env.CRAWLER_MAX_CONCURRENCY), delayMs: o.delayMs, respectRobots: o.respectRobots, renderJavaScript: o.renderJavaScript && env.PLAYWRIGHT_ENABLED, userAgent: o.userAgent ?? env.CRAWLER_USER_AGENT, includePatterns: o.includePatterns, excludePatterns: o.excludePatterns, checkExternalLinks: o.followExternalLinksForStatus, allowHosts: o.allowHosts, allowPorts: o.allowPorts },
      onProgress: (n) => ctx.log.debug({ crawlRunId: run.id, pages: n }, "crawl.progress"),
    });
    await ctx.enqueue({ type: "ALERT_PROCESSING", organizationId: p.organizationId, payload: { reason: "crawl_completed", crawlRunId: run.id } });
    return { crawlRunId: run.id, pages: result.pagesStored, stopReason: result.summary.stopReason, score: result.audit?.scoreOverall ?? null, findings: result.audit?.findings.length ?? 0 };
  } catch (err) {
    await failCrawlRun(p.organizationId, run.id, err instanceof Error ? err.message : String(err));
    await ctx.enqueue({ type: "ALERT_PROCESSING", organizationId: p.organizationId, payload: { reason: "crawl_failed", crawlRunId: run.id } });
    throw err;
  }
};

import { refreshBacklinks } from "@seopilot/backlinks";
import { snapshotDomain } from "@seopilot/competitors";
import { and, eq, schema } from "@seopilot/db";
import { syncGa4, recordGa4Failure } from "@seopilot/ga4";
import { syncGsc, recordGscFailure } from "@seopilot/gsc";
import { refreshKeywordMetrics } from "@seopilot/keywords";
import { persistPageSpeed, runPageSpeed, type Strategy } from "@seopilot/pagespeed";
import { requireProvider } from "@seopilot/providers";
import { AppError } from "@seopilot/shared";
import type { JobEnvelope, JobHandler } from "../types";

export const keywordRefresh: JobHandler<JobEnvelope & { keywordIds?: string[] }> = async (p, ctx) => {
  if (!p.projectId) throw new Error("KEYWORD_REFRESH requires projectId");
  const provider = requireProvider("keywords");
  const r = await ctx.tx((tx) => refreshKeywordMetrics(tx, provider, { projectId: p.projectId!, keywordIds: p.keywordIds, jobId: p.jobId }));
  return { refreshed: r.refreshed, costUsd: r.costUsd };
};

export const backlinkRefresh: JobHandler<JobEnvelope> = async (p, ctx) => {
  if (!p.projectId) throw new Error("BACKLINK_REFRESH requires projectId");
  const provider = requireProvider("backlinks");
  const r = await ctx.tx(async (tx) => {
    const [project] = await tx.select({ domain: schema.projects.domain }).from(schema.projects).where(eq(schema.projects.id, p.projectId!)).limit(1);
    if (!project) throw new AppError("NOT_FOUND", "Project not found");
    return refreshBacklinks(tx, provider, { projectId: p.projectId!, organizationId: p.organizationId, target: project.domain, jobId: p.jobId });
  });
  if (r.lostLinks > 0) await ctx.enqueue({ type: "ALERT_PROCESSING", organizationId: p.organizationId, payload: { reason: "backlinks", snapshotId: r.snapshotId } });
  return { snapshotId: r.snapshotId, newLinks: r.newLinks, lostLinks: r.lostLinks };
};

export const competitorCheck: JobHandler<JobEnvelope & { competitorIds?: string[] }> = async (p, ctx) => {
  if (!p.projectId) throw new Error("COMPETITOR_CHECK requires projectId");
  const provider = requireProvider("competitors");
  const { project, competitors } = await ctx.tx(async (tx) => {
    const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, p.projectId!)).limit(1);
    if (!project) throw new AppError("NOT_FOUND", "Project not found");
    const rows = await tx.select().from(schema.competitors).where(and(eq(schema.competitors.projectId, p.projectId!), eq(schema.competitors.isActive, true)));
    return { project, competitors: p.competitorIds?.length ? rows.filter((c) => p.competitorIds!.includes(c.id)) : rows };
  });
  let done = 0, failed = 0;
  // Own domain first so gap analysis has a baseline, then each competitor in its own tx.
  const targets = [{ competitorId: null as string | null, domain: project.domain }, ...competitors.map((c) => ({ competitorId: c.id as string | null, domain: c.domain }))];
  for (const t of targets) {
    if (ctx.signal.aborted) break;
    try {
      await ctx.tx((tx) => snapshotDomain(tx, provider, { projectId: project.id, organizationId: p.organizationId, competitorId: t.competitorId, domain: t.domain, country: project.country, language: project.language, jobId: p.jobId }));
      done++;
    } catch (err) {
      failed++;
      ctx.log.warn({ domain: t.domain, err: err instanceof Error ? err.message : String(err) }, "competitor.failed");
      if (err instanceof AppError && (err.code === "INSUFFICIENT_CREDITS" || err.code === "PROVIDER_AUTH_FAILED")) break;
    }
  }
  return { snapshots: done, failed };
};

export const gscSync: JobHandler<JobEnvelope & { lookbackDays?: number }> = async (p, ctx) => {
  if (!p.projectId) throw new Error("GSC_SYNC requires projectId");
  try {
    const r = await ctx.tx((tx) => syncGsc(tx, { projectId: p.projectId!, organizationId: p.organizationId, lookbackDays: p.lookbackDays }));
    await ctx.enqueue({ type: "ALERT_PROCESSING", organizationId: p.organizationId, payload: { reason: "gsc_sync" } });
    return { ...r };
  } catch (err) {
    await ctx.tx((tx) => recordGscFailure(tx, p.projectId!, err));
    if (err instanceof AppError && (err.code === "PROVIDER_AUTH_FAILED" || err.code === "PROVIDER_NOT_CONFIGURED")) {
      await ctx.enqueue({ type: "ALERT_PROCESSING", organizationId: p.organizationId, payload: { reason: "gsc_reauth" } });
      return { skipped: true, reason: err.code }; // not retryable
    }
    throw err;
  }
};

export const ga4Sync: JobHandler<JobEnvelope & { lookbackDays?: number }> = async (p, ctx) => {
  if (!p.projectId) throw new Error("GA4_SYNC requires projectId");
  try {
    return { ...(await ctx.tx((tx) => syncGa4(tx, { projectId: p.projectId!, organizationId: p.organizationId, lookbackDays: p.lookbackDays }))) };
  } catch (err) {
    await ctx.tx((tx) => recordGa4Failure(tx, p.projectId!, err));
    if (err instanceof AppError && (err.code === "PROVIDER_AUTH_FAILED" || err.code === "PROVIDER_NOT_CONFIGURED")) return { skipped: true, reason: err.code };
    throw err;
  }
};

export const pagespeedCheck: JobHandler<JobEnvelope & { urls?: string[]; strategies?: Strategy[] }> = async (p, ctx) => {
  if (!p.projectId) throw new Error("PAGESPEED_CHECK requires projectId");
  const urls = p.urls?.length ? p.urls.slice(0, 25) : await ctx.tx(async (tx) => {
    const [project] = await tx.select({ siteUrl: schema.projects.siteUrl }).from(schema.projects).where(eq(schema.projects.id, p.projectId!)).limit(1);
    return project ? [project.siteUrl] : [];
  });
  const strategies = p.strategies?.length ? p.strategies : (["mobile", "desktop"] as Strategy[]);
  let ok = 0, failed = 0;
  for (const url of urls) {
    for (const strategy of strategies) {
      if (ctx.signal.aborted) break;
      try {
        await ctx.tx((tx) => tx.execute(`SELECT 1`)); // cheap liveness before a slow external call
        const result = await runPageSpeed(url, strategy, { env: ctx.env });
        await ctx.tx((tx) => persistPageSpeed(tx, { projectId: p.projectId!, organizationId: p.organizationId, result }));
        if (result.errorMessage) failed++;
        else ok++;
      } catch (err) {
        failed++;
        ctx.log.warn({ url, strategy, err: err instanceof Error ? err.message : String(err) }, "pagespeed.failed");
        if (err instanceof AppError && err.code === "RATE_LIMITED") throw err; // let pg-boss back off
      }
    }
  }
  return { urls: urls.length, ok, failed };
};

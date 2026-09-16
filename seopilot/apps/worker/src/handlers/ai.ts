import { buildAiProviders, type AiProviderName } from "@seopilot/ai";
import { eq, schema } from "@seopilot/db";
import { activePrompts, checkPrompt, createVisibilityRun, finishVisibilityRun } from "@seopilot/geo";
import { AppError } from "@seopilot/shared";
import type { JobEnvelope, JobHandler } from "../types";

export const aiVisibilityCheck: JobHandler<JobEnvelope & { providers?: AiProviderName[]; interpretSentiment?: boolean }> = async (p, ctx) => {
  if (!p.projectId) throw new Error("AI_VISIBILITY_CHECK requires projectId");
  const all = buildAiProviders(ctx.env);
  const names = (p.providers?.length ? p.providers : [...all.keys()]).filter((n) => all.has(n));
  if (!names.length) throw new AppError("PROVIDER_NOT_CONFIGURED", "No AI provider configured for visibility checks", { provider: "ai" }, { reportable: false });
  const { run, prompts, brand, competitors } = await ctx.tx(async (tx) => {
    const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, p.projectId!)).limit(1);
    if (!project) throw new AppError("NOT_FOUND", "Project not found");
    const comps = await tx.select({ domain: schema.competitors.domain, name: schema.competitors.name }).from(schema.competitors).where(eq(schema.competitors.projectId, p.projectId!));
    const run = await createVisibilityRun(tx, { projectId: p.projectId!, organizationId: p.organizationId, jobId: p.jobId, providers: names });
    return { run, prompts: await activePrompts(tx, p.projectId!), brand: { brandName: project.brandName, aliases: project.brandAliases, domain: project.domain }, competitors: comps };
  });
  let failures = 0, attempted = 0;
  outer: for (const prompt of prompts) {
    for (const name of names) {
      if (ctx.signal.aborted) break outer;
      attempted++;
      try {
        await ctx.tx((tx) => checkPrompt(tx, { run, prompt, provider: all.get(name)!, brand, competitors, jobId: p.jobId, interpretSentiment: p.interpretSentiment ?? false }));
      } catch (err) {
        failures++;
        ctx.log.warn({ promptId: prompt.id, provider: name, err: err instanceof Error ? err.message : String(err) }, "aivis.failed");
        if (err instanceof AppError && (err.code === "INSUFFICIENT_CREDITS" || err.code === "PLAN_LIMIT_REACHED")) break outer;
      }
    }
  }
  const fin = await ctx.tx((tx) => finishVisibilityRun(tx, run.id, { failures, attempted }));
  return { runId: run.id, status: fin.status, attempted, failures, summary: fin.summary };
};

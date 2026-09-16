/**
 * Generative Engine Optimization monitoring (spec §31). For each active prompt
 * we ask configured AI providers the user's question and MEASURE whether the
 * brand is mentioned/cited. Sentiment is model-interpreted and labelled so.
 */
import { and, desc, eq, schema, sql, type Transaction } from "@seopilot/db";
import { parseStructured, runMeteredAi, type AiProvider } from "@seopilot/ai";
import { AppError } from "@seopilot/shared";
import { consumeCredits, recordUsage } from "@seopilot/usage";
import { z } from "zod";
import { measureAnswer, summarize, type BrandProfile, type CompetitorProfile } from "./measure";

export async function addVisibilityPrompts(tx: Transaction, input: { projectId: string; organizationId: string; userId: string; prompts: Array<{ prompt: string; topic?: string | null }> }) {
  const clean = input.prompts.map((p) => ({ prompt: p.prompt.trim(), topic: p.topic?.trim() || null })).filter((p) => p.prompt.length >= 8 && p.prompt.length <= 500);
  if (!clean.length) throw new AppError("VALIDATION_ERROR", "Provide at least one prompt of 8–500 characters");
  return tx.insert(schema.aiVisibilityPrompts).values(clean.map((p) => ({ ...p, projectId: input.projectId, organizationId: input.organizationId, createdBy: input.userId }))).returning();
}

export async function createVisibilityRun(tx: Transaction, input: { projectId: string; organizationId: string; jobId?: string | null; providers: string[] }) {
  const [cnt] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.aiVisibilityPrompts).where(and(eq(schema.aiVisibilityPrompts.projectId, input.projectId), eq(schema.aiVisibilityPrompts.isActive, true)));
  const [run] = await tx.insert(schema.aiVisibilityRuns).values({ projectId: input.projectId, organizationId: input.organizationId, jobId: input.jobId ?? null, status: "running", promptCount: Number(cnt?.count ?? 0), providers: input.providers, startedAt: new Date() }).returning();
  return run!;
}

const sentimentSchema = z.object({ sentiment: z.enum(["positive", "neutral", "negative", "not_mentioned"]) });

/**
 * Ask one provider one prompt, measure, persist. One transaction per prompt
 * so a failing provider doesn't roll back the others. Charges
 * ai.visibility.prompt (flat) + ai.tokens (actual) via the metered runner.
 */
export async function checkPrompt(tx: Transaction, input: { run: { id: string; projectId: string; organizationId: string }; prompt: { id: string; prompt: string }; provider: AiProvider; brand: BrandProfile; competitors: CompetitorProfile[]; jobId: string; interpretSentiment?: boolean }) {
  const { run, prompt, provider } = input;
  await consumeCredits(tx, { organizationId: run.organizationId, projectId: run.projectId, operation: "ai.visibility.prompt", provider: provider.name, referenceType: "ai_visibility_run", referenceId: run.id, idempotencyKey: `aivis:${input.jobId}:${prompt.id}:${provider.name}` });
  const r = await runMeteredAi(tx, {
    organizationId: run.organizationId,
    projectId: run.projectId,
    feature: "geo.visibility",
    provider,
    request: { messages: [{ role: "user", content: prompt.prompt }], maxTokens: 800, temperature: 0.3, webSearch: provider.supportsWebSearch },
    idempotencyKey: `aivis-tokens:${input.jobId}:${prompt.id}:${provider.name}`,
  });
  const m = measureAnswer(r.text, input.brand, input.competitors, r.citations);
  let sentiment: string | null = null;
  if (input.interpretSentiment && m.brandMentioned) {
    try {
      const s = await runMeteredAi(tx, { organizationId: run.organizationId, projectId: run.projectId, feature: "geo.sentiment", provider, request: { system: "Classify the sentiment expressed toward the named brand in the given answer. Respond only with JSON.", messages: [{ role: "user", content: `Brand: ${input.brand.brandName ?? input.brand.domain}\nAnswer:\n${r.text.slice(0, 4000)}\nReturn {"sentiment":"positive|neutral|negative|not_mentioned"}` }], json: true, maxTokens: 20, temperature: 0 }, idempotencyKey: `aivis-sent:${input.jobId}:${prompt.id}:${provider.name}` });
      sentiment = parseStructured(s.text, sentimentSchema).sentiment;
    } catch {
      sentiment = null; // interpretation is optional; never block measurement
    }
  }
  const [row] = await tx.insert(schema.aiVisibilityResults).values({ runId: run.id, promptId: prompt.id, projectId: run.projectId, organizationId: run.organizationId, provider: provider.name, model: r.model, prompt: prompt.prompt, answer: r.text, ...m, sentiment, sentimentSource: sentiment ? "model_interpretation" : null, aiRunId: r.aiRunId, providerRequestId: r.requestId }).returning({ id: schema.aiVisibilityResults.id });
  await recordUsage(tx, { organizationId: run.organizationId, projectId: run.projectId, metric: "ai_visibility_prompts", quantity: 1, provider: provider.name });
  return { id: row!.id, ...m, sentiment };
}

export async function finishVisibilityRun(tx: Transaction, runId: string, opts: { failures: number; attempted: number }) {
  const results = await tx.select({ provider: schema.aiVisibilityResults.provider, brandMentioned: schema.aiVisibilityResults.brandMentioned, competitorMentions: schema.aiVisibilityResults.competitorMentions, citations: schema.aiVisibilityResults.citations }).from(schema.aiVisibilityResults).where(eq(schema.aiVisibilityResults.runId, runId));
  const summary = summarize(results);
  const [cr] = await tx.select({ credits: sql<number>`COALESCE(-SUM(amount),0)::int` }).from(schema.creditTransactions).where(and(eq(schema.creditTransactions.referenceType, "ai_visibility_run"), eq(schema.creditTransactions.referenceId, runId)));
  const status = results.length === 0 && opts.attempted > 0 ? "failed" : opts.failures > 0 ? "partial" : "completed";
  await tx.update(schema.aiVisibilityRuns).set({ status, summary, costCredits: Number(cr?.credits ?? 0), finishedAt: new Date() }).where(eq(schema.aiVisibilityRuns.id, runId));
  return { status, summary };
}

export async function latestVisibilityRuns(tx: Transaction, projectId: string, limit = 12) {
  return tx.select().from(schema.aiVisibilityRuns).where(eq(schema.aiVisibilityRuns.projectId, projectId)).orderBy(desc(schema.aiVisibilityRuns.createdAt)).limit(limit);
}

export async function activePrompts(tx: Transaction, projectId: string) {
  return tx.select().from(schema.aiVisibilityPrompts).where(and(eq(schema.aiVisibilityPrompts.projectId, projectId), eq(schema.aiVisibilityPrompts.isActive, true)));
}

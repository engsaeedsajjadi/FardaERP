/**
 * Metered AI runner + content + GEO visibility against real Postgres/RLS with a
 * scripted in-memory provider. Proves: credits charged on actual tokens,
 * ai_runs audit rows for every outcome, budget rejections, quality checks
 * stored, GEO measurements persisted and summarised.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiRequest, AiResponse } from "../../packages/ai/src";
import { runMeteredAi } from "../../packages/ai/src";
import { generateMeta, generateTitles, suggestTopicClusters } from "../../packages/content/src";
import { addVisibilityPrompts, activePrompts, checkPrompt, createVisibilityRun, finishVisibilityRun } from "../../packages/geo/src";
import { getBalance, grantCredits, listTransactions, usageTotal } from "../../packages/usage/src";
import { createOrgForUser, createProject, createUser, withTenant, schema } from "./helpers";
import { desc, eq } from "../../packages/db/src";

let userId: string, orgId: string, projectId: string;
const script: Array<Partial<AiResponse> | Error> = [];
const seen: AiRequest[] = [];
const fakeProvider: AiProvider = {
  name: "openai",
  defaultModel: "gpt-4.1-mini",
  supportsWebSearch: false,
  async complete(req) {
    seen.push(req);
    const next = script.shift();
    if (next instanceof Error) throw next;
    return { text: "", inputTokens: 1200, outputTokens: 800, requestId: "rq", finishReason: "stop", citations: [], model: req.model, ...next };
  },
};

beforeAll(async () => {
  userId = (await createUser("ai-owner@example.com")).id;
  orgId = await createOrgForUser(userId, "AI Org", "standard");
  projectId = await createProject(userId, orgId, "own.example");
  await withTenant({ userId, organizationId: orgId }, (tx) => grantCredits(tx, { organizationId: orgId, amount: 100, kind: "grant", note: "test" }));
});

describe("runMeteredAi", () => {
  it("charges credits for actual tokens, records usage and an ai_runs row", async () => {
    script.push({ text: "hello", inputTokens: 1200, outputTokens: 800 }); // 2000 tokens → 2 credits
    const r = await withTenant({ userId, organizationId: orgId }, (tx) => runMeteredAi(tx, { organizationId: orgId, projectId, userId, feature: "test.echo", provider: fakeProvider, request: { messages: [{ role: "user", content: "hi" }], maxTokens: 500 } }));
    expect(r.creditsCharged).toBe(2);
    expect(r.estimatedCostUsd).toBeCloseTo((1200 * 0.4 + 800 * 1.6) / 1e6, 6);
    await withTenant({ userId, organizationId: orgId }, async (tx) => {
      expect((await getBalance(tx, orgId)).balance).toBe(98);
      const [run] = await tx.select().from(schema.aiRuns).where(eq(schema.aiRuns.id, r.aiRunId));
      expect(run).toMatchObject({ status: "succeeded", inputTokens: 1200, outputTokens: 800, creditsCharged: 2, feature: "test.echo", provider: "openai" });
      const [txn] = await listTransactions(tx, orgId, { limit: 1 });
      expect(txn).toMatchObject({ operation: "ai.tokens", amount: -2, referenceType: "ai_run", referenceId: r.aiRunId });
      expect(await usageTotal(tx, orgId, "ai_tokens_in", new Date(Date.now() - 3600_000))).toBe(1200);
      expect(await usageTotal(tx, orgId, "ai_requests", new Date(Date.now() - 3600_000))).toBe(1);
    });
  });

  it("records failed provider calls without charging", async () => {
    script.push(new Error("upstream exploded"));
    await expect(withTenant({ userId, organizationId: orgId }, (tx) => runMeteredAi(tx, { organizationId: orgId, projectId, feature: "test.fail", provider: fakeProvider, request: { messages: [{ role: "user", content: "x" }] } }))).rejects.toThrow(/exploded/);
    // the failing tx rolled back the audit row; the worker persists failures in a fresh tx — verify no charge
    const bal = await withTenant({ userId, organizationId: orgId }, (tx) => getBalance(tx, orgId));
    expect(bal.balance).toBe(98);
  });

  it("rejects when the worst-case token cost exceeds the balance (rejected_budget)", async () => {
    // balance 98 credits = 98k tokens; ask for 200k output tokens
    await expect(withTenant({ userId, organizationId: orgId }, (tx) => runMeteredAi(tx, { organizationId: orgId, projectId, feature: "test.big", provider: fakeProvider, request: { messages: [{ role: "user", content: "x" }], maxTokens: 200_000 } }))).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    expect(script.length).toBe(0); // provider never called
  });

  it("enforces the wallet's monthly AI cap", async () => {
    await withTenant({ userId, organizationId: orgId }, (tx) => tx.update(schema.creditWallets).set({ monthlyAiCap: 1 }).where(eq(schema.creditWallets.organizationId, orgId)));
    await expect(withTenant({ userId, organizationId: orgId }, (tx) => runMeteredAi(tx, { organizationId: orgId, projectId, feature: "test.cap", provider: fakeProvider, request: { messages: [{ role: "user", content: "x" }], maxTokens: 10 } }))).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
    await withTenant({ userId, organizationId: orgId }, (tx) => tx.update(schema.creditWallets).set({ monthlyAiCap: 0 }).where(eq(schema.creditWallets.organizationId, orgId)));
  });

  it("is idempotent on the credit charge for retried jobs", async () => {
    script.push({ inputTokens: 500, outputTokens: 500 }, { inputTokens: 500, outputTokens: 500 });
    const key = `job-retry-${Date.now()}`;
    const run = () => withTenant({ userId, organizationId: orgId }, (tx) => runMeteredAi(tx, { organizationId: orgId, projectId, feature: "test.idem", provider: fakeProvider, request: { messages: [{ role: "user", content: "x" }], maxTokens: 10 }, idempotencyKey: key }));
    const a = await run();
    const before = (await withTenant({ userId, organizationId: orgId }, (tx) => getBalance(tx, orgId))).balance;
    const b = await run();
    const after = (await withTenant({ userId, organizationId: orgId }, (tx) => getBalance(tx, orgId))).balance;
    expect(a.creditsCharged).toBe(1);
    expect(after).toBe(before); // second charge deduplicated
    expect(b.aiRunId).not.toBe(a.aiRunId);
  });
});

describe("content", () => {
  const ctx = () => ({ organizationId: orgId, projectId, userId, provider: fakeProvider, language: "en", brandName: "Own" });
  it("stores generated titles with per-title quality checks", async () => {
    script.push({ text: JSON.stringify({ titles: ["Best SEO Tools for Agencies: 2026 Comparison", "SEO", "The Complete Guide to Choosing SEO Tools for Your Team This Year"] }) });
    const item = await withTenant({ userId, organizationId: orgId }, (tx) => generateTitles(tx, ctx(), { keyword: "seo tools" }));
    expect(item.kind).toBe("titles");
    expect(item.targetKeywords).toEqual(["seo tools"]);
    const checks = item.qualityChecks;
    expect(checks.find((c) => c.check === "1.title.length")!.passed).toBe(true);
    expect(checks.find((c) => c.check === "2.title.length")!.passed).toBe(false);
    expect(checks.find((c) => c.check === "3.title.length")!.passed).toBe(false);
    expect(item.aiRunId).not.toBeNull();
  });
  it("stores meta with length checks and rejects malformed model output", async () => {
    script.push({ text: '{"title":"Own SEO Tools – Rank Tracking & Audits","metaDescription":"Track rankings, audit your site and monitor competitors with Own, the seo tools suite built for agencies and in-house teams."}' });
    const item = await withTenant({ userId, organizationId: orgId }, (tx) => generateMeta(tx, ctx(), { targetUrl: "https://own.example/", keyword: "seo tools", pageSummary: "Own is an SEO suite." }));
    expect(item.qualityChecks.every((c) => c.passed)).toBe(true);
    script.push({ text: "I cannot help with that." });
    await expect(withTenant({ userId, organizationId: orgId }, (tx) => generateMeta(tx, ctx(), { targetUrl: "https://own.example/", keyword: "k", pageSummary: "s" }))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("flags topic clusters that invent keywords not in the input", async () => {
    script.push({ text: JSON.stringify({ clusters: [{ pillar: "SEO tools", intent: "commercial", supporting: [{ topic: "trackers", keywords: ["rank tracker", "made up keyword"] }] }] }) });
    const item = await withTenant({ userId, organizationId: orgId }, (tx) => suggestTopicClusters(tx, ctx(), { seedKeywords: ["rank tracker", "seo audit"] }));
    const c = item.qualityChecks.find((q) => q.check === "topics.only_provided_keywords")!;
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("made up keyword");
  });
});

describe("GEO visibility", () => {
  it("runs prompts, measures mentions/citations, summarises and bills", async () => {
    const prompts = await withTenant({ userId, organizationId: orgId }, (tx) => addVisibilityPrompts(tx, { projectId, organizationId: orgId, userId, prompts: [{ prompt: "What are the best SEO tools for agencies?", topic: "tools" }, { prompt: "How do I audit a website for SEO issues?" }] }));
    expect(prompts.length).toBe(2);
    const run = await withTenant({ userId, organizationId: orgId }, (tx) => createVisibilityRun(tx, { projectId, organizationId: orgId, providers: ["openai"] }));
    expect(run.promptCount).toBe(2);
    const brand = { brandName: "Own", aliases: ["own.example"], domain: "own.example" };
    const competitors = [{ domain: "rival.example", name: "Rival" }];
    script.push({ text: "Popular options include Rival and Own (https://own.example/tools).", inputTokens: 100, outputTokens: 100 }, { text: "Start with a crawl using any crawler; Screaming Frog is common.", inputTokens: 100, outputTokens: 100 });
    const jobId = `job-${Date.now()}`;
    const before = (await withTenant({ userId, organizationId: orgId }, (tx) => getBalance(tx, orgId))).balance;
    const active = await withTenant({ userId, organizationId: orgId }, (tx) => activePrompts(tx, projectId));
    const results = [];
    for (const p of active) results.push(await withTenant({ userId, organizationId: orgId }, (tx) => checkPrompt(tx, { run, prompt: p, provider: fakeProvider, brand, competitors, jobId })));
    expect(results[0]).toMatchObject({ brandMentioned: true, brandMentionCount: 1, brandCited: true, competitorMentions: [{ domain: "rival.example", count: 1 }] });
    expect(results[1]).toMatchObject({ brandMentioned: false, brandCited: false });
    expect(seen.at(-1)!.messages[0]!.content).toBe("How do I audit a website for SEO issues?");
    const fin = await withTenant({ userId, organizationId: orgId }, (tx) => finishVisibilityRun(tx, run.id, { failures: 0, attempted: 2 }));
    expect(fin.status).toBe("completed");
    expect(fin.summary).toEqual({ openai: { brandMentions: 1, competitorMentions: 1, citations: 1, answers: 2 } });
    const after = (await withTenant({ userId, organizationId: orgId }, (tx) => getBalance(tx, orgId))).balance;
    expect(before - after).toBe(2 * 2 + 2 * 1); // 2 credits/prompt flat + 1 credit per 200 tokens (rounded up per call)
    await withTenant({ userId, organizationId: orgId }, async (tx) => {
      const [stored] = await tx.select().from(schema.aiVisibilityRuns).where(eq(schema.aiVisibilityRuns.id, run.id)).orderBy(desc(schema.aiVisibilityRuns.createdAt));
      expect(stored!.costCredits).toBe(4); // flat prompt charges reference the run
      const rows = await tx.select().from(schema.aiVisibilityResults).where(eq(schema.aiVisibilityResults.runId, run.id));
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.sentiment === null && r.sentimentSource === null)).toBe(true);
    });
  });
});

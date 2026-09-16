/**
 * Metered AI execution (spec §28–29). Every call:
 *  1. checks plan feature + monthly AI operation limit + wallet monthly AI cap
 *  2. pre-authorises credits for the max possible tokens (rejected_budget row when short)
 *  3. calls the provider
 *  4. charges the ACTUAL tokens (refunding the pre-authorisation), records usage
 *  5. writes an ai_runs row — succeeded / failed / rejected_budget — always.
 */
import { eq, schema, type Transaction } from "@seopilot/db";
import { AppError } from "@seopilot/shared";
import { assertMonthlyLimit, consumeCredits, consumedSince, creditsFor, getBalance, grantCredits, recordUsage, startOfMonthUtc } from "@seopilot/usage";
import { estimateCostUsd } from "./pricing";
import type { AiProvider, AiRequest, AiResponse } from "./types";

export interface MeteredAiInput {
  organizationId: string;
  projectId?: string | null;
  userId?: string | null;
  feature: string;
  provider: AiProvider;
  request: Omit<AiRequest, "model"> & { model?: string };
  /** Idempotency key for the credit charge (e.g. `${jobId}:${feature}:${promptId}`). */
  idempotencyKey?: string | null;
  /** Tokens assumed for pre-authorisation when the request doesn't cap output. */
  estimatedInputTokens?: number;
}

export interface MeteredAiResult extends AiResponse {
  aiRunId: string;
  creditsCharged: number;
  estimatedCostUsd: number | null;
  latencyMs: number;
}

/** Rough token estimate (4 chars ≈ 1 token) used only for pre-authorisation, never billing. */
export function roughTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function insertRun(tx: Transaction, row: typeof schema.aiRuns.$inferInsert): Promise<string> {
  const [r] = await tx.insert(schema.aiRuns).values(row).returning({ id: schema.aiRuns.id });
  return r!.id;
}

export async function runMeteredAi(tx: Transaction, input: MeteredAiInput): Promise<MeteredAiResult> {
  const provider = input.provider;
  const model = input.request.model ?? provider.defaultModel;
  const base = { organizationId: input.organizationId, projectId: input.projectId ?? null, userId: input.userId ?? null, feature: input.feature, provider: provider.name, model };

  // 1. plan limit on AI operations + wallet monthly AI cap
  await assertMonthlyLimit(tx, input.organizationId, "ai_requests", 1);
  const wallet = await getBalance(tx, input.organizationId);
  if (wallet.monthlyAiCap > 0) {
    const used = await consumedSince(tx, input.organizationId, startOfMonthUtc(), "ai.");
    if (used >= wallet.monthlyAiCap) {
      await insertRun(tx, { ...base, status: "rejected_budget", errorMessage: `Monthly AI credit cap reached (${used}/${wallet.monthlyAiCap})` });
      throw new AppError("PLAN_LIMIT_REACHED", `Monthly AI credit cap reached (${used}/${wallet.monthlyAiCap}). Raise the cap in billing settings.`, { used, cap: wallet.monthlyAiCap, upgradeRequired: false }, { reportable: false });
    }
  }

  // 2. pre-authorise for the worst case
  const promptChars = (input.request.system ?? "").length + input.request.messages.reduce((n, m) => n + m.content.length, 0);
  const maxTokens = (input.estimatedInputTokens ?? Math.ceil(promptChars / 4)) + (input.request.maxTokens ?? 1024);
  const needed = creditsFor("ai.tokens", maxTokens);
  if (wallet.balance < needed) {
    await insertRun(tx, { ...base, status: "rejected_budget", errorMessage: `Insufficient credits: need up to ${needed}, balance ${wallet.balance}` });
    throw new AppError("INSUFFICIENT_CREDITS", `This AI operation may use up to ${needed} credits; balance is ${wallet.balance}.`, { required: needed, balance: wallet.balance, operation: "ai.tokens" }, { reportable: false });
  }

  // 3. call the provider
  const started = Date.now();
  let response: AiResponse;
  try {
    response = await provider.complete({ ...input.request, model });
  } catch (err) {
    const latencyMs = Date.now() - started;
    await insertRun(tx, { ...base, status: "failed", latencyMs, errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    throw err;
  }
  const latencyMs = Date.now() - started;

  // 4. charge actual tokens
  const totalTokens = response.inputTokens + response.outputTokens;
  const estimatedCostUsd = estimateCostUsd(provider.name, response.model, response.inputTokens, response.outputTokens);
  const charge = await consumeCredits(tx, { organizationId: input.organizationId, projectId: input.projectId ?? null, operation: "ai.tokens", quantity: Math.max(totalTokens, 1), provider: provider.name, providerCostUsd: estimatedCostUsd, referenceType: "ai_run", idempotencyKey: input.idempotencyKey ?? null, actorUserId: input.userId ?? null, note: input.feature });
  await recordUsage(tx, { organizationId: input.organizationId, projectId: input.projectId ?? null, metric: "ai_requests", quantity: 1, provider: provider.name });
  await recordUsage(tx, { organizationId: input.organizationId, projectId: input.projectId ?? null, metric: "ai_tokens_in", quantity: response.inputTokens, provider: provider.name });
  await recordUsage(tx, { organizationId: input.organizationId, projectId: input.projectId ?? null, metric: "ai_tokens_out", quantity: response.outputTokens, provider: provider.name });

  // 5. audit row
  const creditsCharged = Math.abs(charge.amount);
  const aiRunId = await insertRun(tx, { ...base, model: response.model, status: "succeeded", inputTokens: response.inputTokens, outputTokens: response.outputTokens, estimatedCostUsd, creditsCharged, latencyMs, providerRequestId: response.requestId });
  if (charge.transactionId) await tx.update(schema.creditTransactions).set({ referenceId: aiRunId }).where(eq(schema.creditTransactions.id, charge.transactionId));
  return { ...response, aiRunId, creditsCharged, estimatedCostUsd, latencyMs };
}

/** Re-export so feature packages can top up test wallets without importing usage directly. */
export { grantCredits };

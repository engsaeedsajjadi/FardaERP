/**
 * Credit ledger. All balance changes go through `applyCreditTransaction` inside
 * a transaction holding a row lock on the wallet, so concurrent consumers
 * cannot overdraw. Idempotency keys make retries (worker jobs, webhooks) safe.
 */
import { and, desc, eq, gte, schema, sql, type Transaction } from "@seopilot/db";
import { AppError } from "@seopilot/shared";
import { creditsFor, type MeteredOperation } from "./pricing";

export interface ConsumeInput {
  organizationId: string;
  projectId?: string | null;
  operation: MeteredOperation;
  quantity?: number;
  provider?: string | null;
  providerCostUsd?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  actorUserId?: string | null;
  note?: string | null;
}

export interface GrantInput {
  organizationId: string;
  amount: number;
  kind?: "grant" | "purchase" | "refund" | "adjustment";
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  actorUserId?: string | null;
  note?: string | null;
  expiresAt?: Date | null;
}

export interface LedgerResult {
  applied: boolean;
  transactionId: string | null;
  amount: number;
  balanceAfter: number;
}

async function lockWallet(tx: Transaction, organizationId: string) {
  const res = await tx.execute<{ id: string; balance: number }>(sql`SELECT id, balance FROM credit_wallets WHERE organization_id = ${organizationId} FOR UPDATE`);
  const row = res.rows[0];
  if (!row) {
    const [created] = await tx.insert(schema.creditWallets).values({ organizationId, balance: 0 }).returning({ id: schema.creditWallets.id, balance: schema.creditWallets.balance });
    if (!created) throw new AppError("INTERNAL_ERROR", "Could not create credit wallet");
    return created;
  }
  return { id: row.id, balance: Number(row.balance) };
}

async function existingByIdempotency(tx: Transaction, key: string | null | undefined) {
  if (!key) return null;
  const [row] = await tx.select({ id: schema.creditTransactions.id, amount: schema.creditTransactions.amount, balanceAfter: schema.creditTransactions.balanceAfter }).from(schema.creditTransactions).where(eq(schema.creditTransactions.idempotencyKey, key)).limit(1);
  return row ?? null;
}

/** Charge credits for an operation. Throws INSUFFICIENT_CREDITS (402) when the balance would go negative. */
export async function consumeCredits(tx: Transaction, input: ConsumeInput): Promise<LedgerResult> {
  const quantity = input.quantity ?? 1;
  const amount = creditsFor(input.operation, quantity);
  const prior = await existingByIdempotency(tx, input.idempotencyKey);
  if (prior) return { applied: false, transactionId: prior.id, amount: prior.amount, balanceAfter: prior.balanceAfter };
  const wallet = await lockWallet(tx, input.organizationId);
  if (amount === 0) {
    return { applied: false, transactionId: null, amount: 0, balanceAfter: wallet.balance };
  }
  if (wallet.balance < amount) {
    throw new AppError("INSUFFICIENT_CREDITS", `This operation needs ${amount} credit${amount === 1 ? "" : "s"}; balance is ${wallet.balance}.`, { required: amount, balance: wallet.balance, operation: input.operation }, { reportable: false });
  }
  const balanceAfter = wallet.balance - amount;
  await tx.update(schema.creditWallets).set({ balance: balanceAfter, updatedAt: new Date() }).where(eq(schema.creditWallets.id, wallet.id));
  const [row] = await tx
    .insert(schema.creditTransactions)
    .values({
      walletId: wallet.id,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      kind: "consumption",
      amount: -amount,
      balanceAfter,
      operation: input.operation,
      provider: input.provider ?? null,
      quantity,
      providerCostUsd: input.providerCostUsd ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      actorUserId: input.actorUserId ?? null,
      note: input.note ?? null,
    })
    .returning({ id: schema.creditTransactions.id });
  return { applied: true, transactionId: row?.id ?? null, amount: -amount, balanceAfter };
}

export async function grantCredits(tx: Transaction, input: GrantInput): Promise<LedgerResult> {
  if (!Number.isInteger(input.amount) || input.amount === 0) throw new AppError("VALIDATION_ERROR", "Credit amount must be a non-zero integer");
  const prior = await existingByIdempotency(tx, input.idempotencyKey);
  if (prior) return { applied: false, transactionId: prior.id, amount: prior.amount, balanceAfter: prior.balanceAfter };
  const wallet = await lockWallet(tx, input.organizationId);
  const balanceAfter = wallet.balance + input.amount;
  if (balanceAfter < 0) throw new AppError("VALIDATION_ERROR", "Adjustment would make the balance negative", { balance: wallet.balance, amount: input.amount });
  await tx.update(schema.creditWallets).set({ balance: balanceAfter, updatedAt: new Date() }).where(eq(schema.creditWallets.id, wallet.id));
  const [row] = await tx
    .insert(schema.creditTransactions)
    .values({
      walletId: wallet.id,
      organizationId: input.organizationId,
      kind: input.kind ?? "grant",
      amount: input.amount,
      balanceAfter,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      actorUserId: input.actorUserId ?? null,
      note: input.note ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: schema.creditTransactions.id });
  return { applied: true, transactionId: row?.id ?? null, amount: input.amount, balanceAfter };
}

export async function getBalance(tx: Transaction, organizationId: string): Promise<{ balance: number; lowBalanceThreshold: number; monthlyAiCap: number }> {
  const [w] = await tx.select({ balance: schema.creditWallets.balance, lowBalanceThreshold: schema.creditWallets.lowBalanceThreshold, monthlyAiCap: schema.creditWallets.monthlyAiCap }).from(schema.creditWallets).where(eq(schema.creditWallets.organizationId, organizationId)).limit(1);
  return w ?? { balance: 0, lowBalanceThreshold: 100, monthlyAiCap: 0 };
}

export async function listTransactions(tx: Transaction, organizationId: string, opts: { limit?: number; since?: Date } = {}) {
  const where = opts.since ? and(eq(schema.creditTransactions.organizationId, organizationId), gte(schema.creditTransactions.createdAt, opts.since)) : eq(schema.creditTransactions.organizationId, organizationId);
  return tx.select().from(schema.creditTransactions).where(where).orderBy(desc(schema.creditTransactions.createdAt)).limit(Math.min(opts.limit ?? 100, 1000));
}

/** Credits consumed for an operation prefix (e.g. "ai.") since a date — used for the monthly AI cap. */
export async function consumedSince(tx: Transaction, organizationId: string, since: Date, operationPrefix?: string): Promise<number> {
  const res = await tx.execute<{ used: number }>(sql`
    SELECT COALESCE(-SUM(amount), 0)::int AS used FROM credit_transactions
    WHERE organization_id = ${organizationId} AND kind = 'consumption' AND created_at >= ${since}
    ${operationPrefix ? sql`AND operation LIKE ${`${operationPrefix}%`}` : sql``}`);
  return Number(res.rows[0]?.used ?? 0);
}

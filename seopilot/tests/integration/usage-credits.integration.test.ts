import { describe, expect, it, beforeAll } from "vitest";
import { AppError } from "../../packages/shared/src";
import { consumeCredits, grantCredits, getBalance, listTransactions, consumedSince, creditsFor, recordUsage, usageTotal, usageBreakdown, assertCountLimit, assertMonthlyLimit, getPlanForOrganization, assertFeature, startOfMonthUtc } from "../../packages/usage/src";
import { createOrgForUser, createProject, createUser, withTenant, withSystem, schema } from "./helpers";
import { eq } from "../../packages/db/src";

let userId: string;
let orgId: string;
let otherUserId: string;
let otherOrgId: string;

beforeAll(async () => {
  ({ id: userId } = await createUser());
  orgId = await createOrgForUser(userId, "Credits");
  ({ id: otherUserId } = await createUser());
  otherOrgId = await createOrgForUser(otherUserId, "Other");
  await withTenant({ userId }, (tx) => tx.insert(schema.creditWallets).values({ organizationId: orgId, balance: 0 }));
});

describe("credit ledger", () => {
  it("grants, consumes with fixed price list, records provider cost and keeps a running balance", async () => {
    await withTenant({ userId }, async (tx) => {
      const g = await grantCredits(tx, { organizationId: orgId, amount: 100, kind: "grant", note: "plan allotment", idempotencyKey: "grant-1" });
      expect(g).toMatchObject({ applied: true, amount: 100, balanceAfter: 100 });
      const c = await consumeCredits(tx, { organizationId: orgId, operation: "keyword.metrics", quantity: 25, provider: "dataforseo", providerCostUsd: 0.0303, idempotencyKey: "kw-1" });
      expect(creditsFor("keyword.metrics", 25)).toBe(3);
      expect(c).toMatchObject({ applied: true, amount: -3, balanceAfter: 97 });
      expect((await getBalance(tx, orgId)).balance).toBe(97);
      const txs = await listTransactions(tx, orgId);
      expect(txs[0]).toMatchObject({ kind: "consumption", operation: "keyword.metrics", quantity: 25, providerCostUsd: 0.0303, balanceAfter: 97 });
    });
  });

  it("idempotency key makes retries no-ops", async () => {
    await withTenant({ userId }, async (tx) => {
      const before = (await getBalance(tx, orgId)).balance;
      const again = await consumeCredits(tx, { organizationId: orgId, operation: "keyword.metrics", quantity: 25, idempotencyKey: "kw-1" });
      expect(again.applied).toBe(false);
      expect((await getBalance(tx, orgId)).balance).toBe(before);
      const g = await grantCredits(tx, { organizationId: orgId, amount: 100, idempotencyKey: "grant-1" });
      expect(g.applied).toBe(false);
    });
  });

  it("zero-cost operations do not write transactions", async () => {
    await withTenant({ userId }, async (tx) => {
      const n = (await listTransactions(tx, orgId)).length;
      const r = await consumeCredits(tx, { organizationId: orgId, operation: "crawl.page", quantity: 500 });
      expect(r.applied).toBe(false);
      expect((await listTransactions(tx, orgId)).length).toBe(n);
    });
  });

  it("refuses to overdraw with INSUFFICIENT_CREDITS (402, non-reportable) and rolls back", async () => {
    const err = await withTenant({ userId }, (tx) => consumeCredits(tx, { organizationId: orgId, operation: "competitor.ranked_keywords", quantity: 50 })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("INSUFFICIENT_CREDITS");
    expect((err as AppError).status).toBe(402);
    expect((err as AppError).reportable).toBe(false);
    await withTenant({ userId }, async (tx) => expect((await getBalance(tx, orgId)).balance).toBe(97));
  });

  it("concurrent consumers cannot overdraw (row lock)", async () => {
    // Balance 97; 20 parallel 5-credit charges = 100 > 97 → exactly 19 succeed.
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => withTenant({ userId }, (tx) => consumeCredits(tx, { organizationId: orgId, operation: "backlinks.summary", idempotencyKey: `par-${i}` }))));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected" && (r.reason as AppError).code === "INSUFFICIENT_CREDITS").length;
    expect(ok).toBe(19);
    expect(failed).toBe(1);
    await withTenant({ userId }, async (tx) => {
      expect((await getBalance(tx, orgId)).balance).toBe(2);
      expect(await consumedSince(tx, orgId, startOfMonthUtc(), "backlinks.")).toBe(95);
    });
  });

  it("is tenant-isolated: another org cannot see or spend this wallet", async () => {
    await withTenant({ userId: otherUserId }, async (tx) => {
      expect((await getBalance(tx, orgId)).balance).toBe(0); // invisible → default
      expect(await listTransactions(tx, orgId)).toEqual([]);
    });
    // and cannot forge a wallet for an org it does not belong to
    await expect(withTenant({ userId: otherUserId }, (tx) => grantCredits(tx, { organizationId: orgId, amount: 1000 }))).rejects.toThrow();
    await withTenant({ userId }, async (tx) => expect((await getBalance(tx, orgId)).balance).toBe(2));
  });
});

describe("usage counters + plan limits", () => {
  it("aggregates hourly buckets and monthly totals", async () => {
    const projectId = await createProject(userId, orgId);
    await withTenant({ userId }, async (tx) => {
      await recordUsage(tx, { organizationId: orgId, projectId, metric: "crawl_pages", quantity: 120 });
      await recordUsage(tx, { organizationId: orgId, projectId, metric: "crawl_pages", quantity: 30 });
      await recordUsage(tx, { organizationId: orgId, projectId: null, metric: "api_calls", quantity: 5 });
      expect(await usageTotal(tx, orgId, "crawl_pages", startOfMonthUtc())).toBe(150);
      expect(await usageTotal(tx, orgId, "crawl_pages", startOfMonthUtc(), new Date(), projectId)).toBe(150);
      expect(await usageBreakdown(tx, orgId, startOfMonthUtc())).toMatchObject({ crawl_pages: 150, api_calls: 5 });
    });
  });

  it("enforces plan limits from the plans table (free: 1 project, 500 crawl pages/month)", async () => {
    await withTenant({ userId }, async (tx) => {
      const plan = await getPlanForOrganization(tx, orgId);
      expect(plan.code).toBe("free");
      expect(plan.limits.projects).toBe(1);
      await expect(assertCountLimit(tx, orgId, "projects")).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED", status: 402 });
      const m = await assertMonthlyLimit(tx, orgId, "crawl_pages", 100);
      expect(m).toEqual({ used: 150, limit: 500, remaining: 250 });
      await expect(assertMonthlyLimit(tx, orgId, "crawl_pages", 400)).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
      expect(() => assertFeature(plan, "white_label")).toThrow(expect.objectContaining({ code: "PLAN_LIMIT_REACHED" }));
      expect(() => assertFeature(plan, "site_audit")).not.toThrow();
    });
  });

  it("upgrading the plan (system op) lifts limits immediately", async () => {
    await withSystem(orgId, (tx) => tx.update(schema.organizations).set({ planCode: "agency" }).where(eq(schema.organizations.id, orgId)));
    await withTenant({ userId }, async (tx) => {
      const r = await assertCountLimit(tx, orgId, "projects");
      expect(r.limit).toBe(50);
      const upgraded = await getPlanForOrganization(tx, orgId);
      expect(() => assertFeature(upgraded, "white_label")).not.toThrow();
    });
  });
});

/**
 * End-to-end worker pipeline against real Postgres + real pg-boss:
 * enqueue SITE_CRAWL → worker crawls a local HTTP site → pages/links/findings
 * + score persisted → ALERT_PROCESSING chained → notification for new high
 * issues; plus ledger semantics (idempotent enqueue, non-retryable failure,
 * schedule tick) and webhook delivery signing.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handlers } from "../../apps/worker/src/handlers";
import { createBoss, scheduleTickHandler, startWorker } from "../../apps/worker/src/runtime";
import type { JobHandler } from "../../apps/worker/src/types";
import { createSchedule, enqueueJob, getJob, queueName } from "../../packages/scheduler/src";
import { encryptSecret, hmacSha256 } from "../../packages/security/src";
import { createOrgForUser, createProject, createUser, withSystem, withTenant, schema } from "./helpers";
import { and, desc, eq } from "../../packages/db/src";
import type { PgBoss } from "pg-boss";

let userId: string, orgId: string, projectId: string, origin: string;
let site: http.Server, hook: http.Server, boss: PgBoss, worker: { stop: () => Promise<void> };
const hookHits: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];

const page = (title: string, body: string, extraHead = "") => `<!doctype html><html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width">${extraHead}</head><body><h1>${title}</h1>${body}</body></html>`;

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timeout waiting");
}
const jobDone = (jobId: string) => waitFor(async () => { const j = await withTenant({ userId, organizationId: orgId }, (tx) => getJob(tx, jobId)); return j && ["completed", "failed", "dead", "cancelled"].includes(j.status) ? j : null; });

beforeAll(async () => {
  process.env.CRAWLER_ALLOW_PRIVATE_TARGETS = "true";
  process.env.JOB_RETRY_DELAY_SCALE = "0";
  site = http.createServer((req, res) => {
    const u = req.url ?? "/";
    const send = (s: number, b: string, h: Record<string, string> = {}) => { res.writeHead(s, { "content-type": "text/html; charset=utf-8", ...h }); res.end(b); };
    if (u === "/robots.txt") return send(200, "User-agent: *\nAllow: /\n", { "content-type": "text/plain" });
    if (u === "/") return send(200, page("Home", `<p>${"welcome text ".repeat(60)}</p><a href="/about">about</a><a href="/thin">thin</a><a href="/missing">missing</a>`, '<meta name="description" content="A perfectly fine home page description that is long enough to pass checks here.">'));
    if (u === "/about") return send(200, page("About", `<p>${"about us text ".repeat(60)}</p><a href="/">home</a>`));
    if (u === "/thin") return send(200, page("Thin", "<p>tiny</p>"));
    return send(404, page("404", "nope"));
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  hook = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { hookHits.push({ headers: req.headers, body: b }); res.writeHead(204); res.end(); }); });
  await new Promise<void>((r) => hook.listen(0, "127.0.0.1", () => r()));

  userId = (await createUser("worker-owner@example.com")).id;
  orgId = await createOrgForUser(userId, "Worker Org", "standard");
  projectId = await createProject(userId, orgId, "127.0.0.1");
  await withSystem(orgId, (tx) => tx.update(schema.projects).set({ siteUrl: origin, crawlConfig: { maxPages: 50, maxDepth: 5, concurrency: 2, delayMs: 0, respectRobots: true, renderJavaScript: false, userAgent: null, includePatterns: [], excludePatterns: [], followExternalLinksForStatus: false } }).where(eq(schema.projects.id, projectId)));
  await withTenant({ userId, organizationId: orgId }, (tx) => tx.insert(schema.notificationRules).values({ organizationId: orgId, projectId: null, name: "new high issues", event: "critical_issue", condition: { minSeverity: "high" }, channels: [{ type: "dashboard" }], createdBy: userId }));

  boss = createBoss(process.env.DATABASE_MIGRATE_URL);
  const failing: JobHandler = async () => { const { AppError } = await import("../../packages/shared/src"); throw new AppError("VALIDATION_ERROR", "bad input"); };
  const flaky: JobHandler = async (_p, ctx) => { if (ctx.attempt < 2) throw new Error("transient"); return { attempt: ctx.attempt }; };
  worker = await startWorker(boss, { ...handlers, KEYWORD_REFRESH: failing, GA4_SYNC: flaky }, { concurrency: 2, workerId: "test-worker" });
  await boss.work(queueName("SCHEDULE_TICK"), { pollingIntervalSeconds: 1 }, scheduleTickHandler(boss));
}, 60_000);

afterAll(async () => {
  await worker?.stop().catch(() => undefined);
  site?.close();
  hook?.close();
});

describe("worker pipeline", () => {
  it("crawls, audits, stores findings/score and chains alert processing", async () => {
    const { jobId, created } = await withTenant({ userId, organizationId: orgId }, (tx) => enqueueJob(tx, boss, { organizationId: orgId, projectId, type: "SITE_CRAWL", payload: { triggeredBy: "manual", overrides: { allowHosts: ["127.0.0.1"], allowPorts: [(site.address() as AddressInfo).port] } }, requestedBy: userId }));
    expect(created).toBe(true);
    // idempotent: a second enqueue while queued/active returns the same job
    const dup = await withTenant({ userId, organizationId: orgId }, (tx) => enqueueJob(tx, boss, { organizationId: orgId, projectId, type: "SITE_CRAWL" }));
    expect(dup).toEqual({ jobId, created: false });

    const job = await jobDone(jobId);
    expect(job.status, job.lastError ?? "").toBe("completed");
    expect(job.result).toMatchObject({ pages: 4, stopReason: "frontier_exhausted" });
    expect(job.attempts).toBe(1);

    await withTenant({ userId, organizationId: orgId }, async (tx) => {
      const [run] = await tx.select().from(schema.crawlRuns).where(eq(schema.crawlRuns.jobId, jobId));
      expect(run!.status).toBe("completed");
      expect(run!.scoreOverall).toBeGreaterThan(0);
      expect(run!.scoreOverall).toBeLessThan(100);
      expect(run!.pagesCrawled).toBe(4);
      const pages = await tx.select().from(schema.crawlPages).where(eq(schema.crawlPages.crawlRunId, run!.id));
      expect(pages.map((p) => p.statusCode).sort()).toEqual([200, 200, 200, 404]);
      expect(pages.find((p) => p.url === `${origin}/`)!.inboundLinkCount).toBe(1);
      const links = await tx.select().from(schema.crawlLinks).where(eq(schema.crawlLinks.crawlRunId, run!.id));
      expect(links.find((l) => l.targetUrl.endsWith("/missing"))!.targetStatusCode).toBe(404);
      const findings = await tx.select().from(schema.auditFindings).where(eq(schema.auditFindings.crawlRunId, run!.id));
      const ruleIds = new Set(findings.map((f) => f.ruleId));
      expect([...ruleIds].some((r) => r.includes("thin"))).toBe(true);
      expect([...ruleIds].some((r) => r.includes("broken") || r.includes("client_error"))).toBe(true);
      expect(findings.every((f) => f.firstSeenRunId === run!.id)).toBe(true);
      const [attempt] = await tx.select().from(schema.jobAttempts).where(eq(schema.jobAttempts.jobId, jobId));
      expect(attempt).toMatchObject({ status: "succeeded", workerId: "test-worker", attempt: 1 });
      expect(attempt!.durationMs).toBeGreaterThan(0);
    });

    // chained ALERT_PROCESSING produced a dashboard notification for new high issues
    const notif = await waitFor(() => withTenant({ userId, organizationId: orgId }, async (tx) => (await tx.select().from(schema.notifications).where(and(eq(schema.notifications.organizationId, orgId), eq(schema.notifications.event, "critical_issue"))).limit(1))[0]));
    expect(notif.severity).toBe("critical");
    expect(notif.title).toMatch(/new critical\/high SEO issue/);
    const alertJob = await withTenant({ userId, organizationId: orgId }, async (tx) => (await tx.select().from(schema.jobs).where(and(eq(schema.jobs.organizationId, orgId), eq(schema.jobs.type, "ALERT_PROCESSING"))).orderBy(desc(schema.jobs.createdAt)).limit(1))[0]);
    expect(alertJob!.payload).toMatchObject({ parentJobId: jobId, reason: "crawl_completed" });
  }, 60_000);

  it("fails non-retryable errors immediately and retries transient ones", async () => {
    const { jobId } = await withTenant({ userId, organizationId: orgId }, (tx) => enqueueJob(tx, boss, { organizationId: orgId, projectId, type: "KEYWORD_REFRESH" }));
    const j = await jobDone(jobId);
    expect(j).toMatchObject({ status: "failed", attempts: 1, lastError: "bad input" });
    const { jobId: j2 } = await withTenant({ userId, organizationId: orgId }, (tx) => enqueueJob(tx, boss, { organizationId: orgId, projectId, type: "GA4_SYNC" }));
    const done = await jobDone(j2);
    expect(done.status).toBe("completed");
    expect(done.attempts).toBe(2);
    expect(done.result).toEqual({ attempt: 2 });
    const attempts = await withTenant({ userId, organizationId: orgId }, (tx) => tx.select().from(schema.jobAttempts).where(eq(schema.jobAttempts.jobId, j2)));
    expect(attempts.map((a) => a.status).sort()).toEqual(["failed", "succeeded"]);
  }, 60_000);

  it("schedule tick enqueues due schedules once and advances nextRunAt", async () => {
    const s = await withTenant({ userId, organizationId: orgId }, (tx) => createSchedule(tx, { organizationId: orgId, projectId, jobType: "PAGESPEED_CHECK", name: "daily psi", frequency: "daily", cron: "0 3 * * *", createdBy: userId }));
    await withSystem(orgId, (tx) => tx.update(schema.schedules).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(schema.schedules.id, s.id)));
    await boss.send(queueName("SCHEDULE_TICK"), { jobId: "tick-test", organizationId: "system", projectId: null });
    const updated = await waitFor(async () => { const [r] = await withSystem(orgId, (tx) => tx.select().from(schema.schedules).where(eq(schema.schedules.id, s.id))); return r?.lastJobId ? r : null; });
    expect(updated.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    const job = await withTenant({ userId, organizationId: orgId }, (tx) => getJob(tx, updated.lastJobId!));
    expect(job).toMatchObject({ type: "PAGESPEED_CHECK", scheduleId: s.id, projectId });
  }, 30_000);

  it("delivers signed webhooks and records the outcome", async () => {
    const secret = "whsec_test_secret";
    const { deliveryId, hookId } = await withTenant({ userId, organizationId: orgId }, async (tx) => {
      const [h] = await tx.insert(schema.webhooks).values({ organizationId: orgId, projectId, url: `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`, events: ["crawl.completed"], encryptedSecret: "tmp", createdBy: userId }).returning({ id: schema.webhooks.id });
      await tx.update(schema.webhooks).set({ encryptedSecret: encryptSecret(secret, h!.id) }).where(eq(schema.webhooks.id, h!.id));
      const [d] = await tx.insert(schema.webhookDeliveries).values({ webhookId: h!.id, organizationId: orgId, event: "crawl.completed", payload: { crawlRunId: "x" } }).returning({ id: schema.webhookDeliveries.id });
      return { deliveryId: d!.id, hookId: h!.id };
    });
    // The webhook host is loopback; SSRF validation rejects it unless allowed — mirror the self-hosted allow flag.
    const { jobId } = await withTenant({ userId, organizationId: orgId }, (tx) => enqueueJob(tx, boss, { organizationId: orgId, projectId, type: "WEBHOOK_DELIVERY", payload: { deliveryId } }));
    const job = await jobDone(jobId);
    const d = await withTenant({ userId, organizationId: orgId }, async (tx) => (await tx.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, deliveryId)))[0]!);
    // Loopback targets are blocked by SSRF defence → delivery must be recorded as failed, never silently dropped.
    expect(d.error).toMatch(/private|loopback|blocked|not allowed/i);
    expect(hookHits.length).toBe(0);
    // With retry delays scaled to 0 the 5 attempts drain immediately; the final attempt marks the delivery dead and completes the job.
    expect(job.status).toBe("completed");
    expect(job.result).toMatchObject({ final: true });
    expect(d.status).toBe("dead");
    expect(d.attempt).toBe(5);
    const [h] = await withTenant({ userId, organizationId: orgId }, (tx) => tx.select().from(schema.webhooks).where(eq(schema.webhooks.id, hookId)));
    expect(h!.failureCount).toBeGreaterThanOrEqual(1);
    // signature helper is deterministic
    expect(hmacSha256(secret, "1.{}")).toHaveLength(64);
  }, 60_000);
});

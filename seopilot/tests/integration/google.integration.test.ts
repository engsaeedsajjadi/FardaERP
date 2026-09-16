/**
 * GSC / GA4 / PageSpeed persistence against real Postgres + RLS, with a fake
 * Google (fetch) so no network is used. Verifies encrypted token storage,
 * refresh-on-expiry, upsert idempotency, reauth marking and usage metering.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { connectGsc, getGscConnection, gscTotals, gscTop, recordGscFailure, syncGsc } from "../../packages/gsc/src";
import { connectGa4, ga4OrganicTotals, getGa4Connection, syncGa4 } from "../../packages/ga4/src";
import { parsePsiResponse, persistPageSpeed, latestPageSpeed } from "../../packages/pagespeed/src";
import { usageTotal } from "../../packages/usage/src";
import { createOrgForUser, createProject, createUser, withTenant, schema } from "./helpers";
import { and, eq } from "../../packages/db/src";

let userId: string, orgId: string, projectId: string;
const calls: string[] = [];
let googleMode: "ok" | "invalid_grant" = "ok";

const fakeGoogle = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  calls.push(url);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    if (googleMode === "invalid_grant") return json({ error: "invalid_grant" }, 400);
    return json({ access_token: `at-${calls.length}`, expires_in: 3600 });
  }
  if (url.includes("/searchAnalytics/query")) {
    const body = JSON.parse(String(init!.body)) as { dimensions: string[]; startRow: number };
    if (body.startRow > 0) return json({ rows: [] });
    const days = ["2026-09-01", "2026-09-02"];
    const rows = days.flatMap((d) => {
      if (body.dimensions.length === 1) return [{ keys: [d], clicks: 10, impressions: 100, ctr: 0.1, position: 8 }];
      const second = body.dimensions[1];
      const vals = second === "query" ? ["seo tools", "seo audit"] : second === "page" ? ["https://own.example/"] : second === "country" ? ["fra"] : second === "device" ? ["MOBILE", "DESKTOP"] : ["x"];
      return vals.map((v, i) => ({ keys: [d, v], clicks: 5 - i, impressions: 50, ctr: (5 - i) / 50, position: 8 + i }));
    });
    return json({ rows });
  }
  if (url.includes(":runReport")) {
    const body = JSON.parse(String(init!.body)) as { dimensions: Array<{ name: string }> };
    const dims = body.dimensions.map((d) => d.name);
    const mk = (d: string, extra: string[]) => ({ dimensionValues: [d, ...extra].map((value) => ({ value })), metricValues: ["40", "30", "55", "35", "2", "19.5", "0.36", "95.2"].map((value) => ({ value })) });
    const rows = ["20260901", "20260902"].flatMap((d) => (dims.length === 1 ? [mk(d, [])] : dims[1] === "sessionDefaultChannelGroup" ? [mk(d, ["Organic Search"]), mk(d, ["Direct"])] : [mk(d, ["v1"])]));
    return json({ rows, rowCount: rows.length });
  }
  return json({ error: { message: `unexpected ${url}` } }, 500);
}) as typeof fetch;

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  userId = (await createUser("google-owner@example.com")).id;
  orgId = await createOrgForUser(userId, "Google Org", "standard");
  projectId = await createProject(userId, orgId, "own.example");
});

describe("Search Console", () => {
  it("stores encrypted tokens, syncs daily rows idempotently and meters gsc_syncs", async () => {
    await withTenant({ userId, organizationId: orgId }, async (tx) => {
      await connectGsc(tx, { projectId, organizationId: orgId, userId, siteUrl: "sc-domain:own.example", permissionLevel: "siteOwner", email: "me@example.com", refreshToken: "rt-secret", accessToken: "at-0", expiresAt: new Date(Date.now() - 1000), scopes: ["webmasters.readonly"] });
      const c = await getGscConnection(tx, projectId);
      expect(c!.encryptedRefreshToken).not.toContain("rt-secret");
      expect(c!.status).toBe("connected");
    });
    const first = await withTenant({ userId, organizationId: orgId }, (tx) => syncGsc(tx, { projectId, organizationId: orgId, fetchImpl: fakeGoogle }));
    expect(calls.some((u) => u.startsWith("https://oauth2.googleapis.com/token"))).toBe(true); // expired token was refreshed
    expect(first.rowsUpserted).toBe(2 + 4 + 2 + 2 + 4);
    const second = await withTenant({ userId, organizationId: orgId }, (tx) => syncGsc(tx, { projectId, organizationId: orgId, fetchImpl: fakeGoogle }));
    expect(second.rowsUpserted).toBe(first.rowsUpserted);
    await withTenant({ userId, organizationId: orgId }, async (tx) => {
      const rows = await tx.select().from(schema.gscMetrics).where(and(eq(schema.gscMetrics.projectId, projectId), eq(schema.gscMetrics.dimension, "query")));
      expect(rows.length).toBe(4); // upsert, no duplicates
      const totals = await gscTotals(tx, projectId, "2026-09-01", "2026-09-02");
      expect(totals).toMatchObject({ clicks: 20, impressions: 200, ctr: 0.1, position: 8, days: 2 });
      const top = await gscTop(tx, projectId, "query", "2026-09-01", "2026-09-02", 10);
      expect(top[0]).toMatchObject({ key: "seo tools", clicks: 10 });
      const c = await getGscConnection(tx, projectId);
      expect(c!.lastSyncedAt).not.toBeNull();
      expect(c!.lastSyncError).toBeNull();
      expect(await usageTotal(tx, orgId, "gsc_syncs", new Date(Date.now() - 3600_000))).toBe(2);
    });
  });

  it("marks the connection needs_reauth when Google revokes the refresh token", async () => {
    googleMode = "invalid_grant";
    await withTenant({ userId, organizationId: orgId }, async (tx) => {
      // force expiry so a refresh is attempted
      await tx.update(schema.gscConnections).set({ accessTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.gscConnections.projectId, projectId));
    });
    // mirrors the worker: failed sync tx rolls back, failure recorded in a fresh tx
    let failure: unknown = null;
    await withTenant({ userId, organizationId: orgId }, (tx) => syncGsc(tx, { projectId, organizationId: orgId, fetchImpl: fakeGoogle })).catch((e: unknown) => (failure = e));
    expect(failure).toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
    await withTenant({ userId, organizationId: orgId }, (tx) => recordGscFailure(tx, projectId, failure));
    const c = await withTenant({ userId, organizationId: orgId }, (tx) => getGscConnection(tx, projectId));
    expect(c!.status).toBe("needs_reauth");
    expect(c!.lastSyncError).toMatch(/reconnect/);
    googleMode = "ok";
  });

  it("rejects sync for a project without a connection", async () => {
    const other = await createProject(userId, orgId, "other.example");
    await expect(withTenant({ userId, organizationId: orgId }, (tx) => syncGsc(tx, { projectId: other, organizationId: orgId, fetchImpl: fakeGoogle }))).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });
});

describe("GA4", () => {
  it("syncs organic metrics with channel breakdown and meters ga4_syncs", async () => {
    await withTenant({ userId, organizationId: orgId }, (tx) => connectGa4(tx, { projectId, organizationId: orgId, userId, propertyId: "properties/42", propertyName: "Own", email: "me@example.com", refreshToken: "rt", accessToken: "at", expiresAt: new Date(Date.now() + 3600_000) }));
    const r = await withTenant({ userId, organizationId: orgId }, (tx) => syncGa4(tx, { projectId, organizationId: orgId, fetchImpl: fakeGoogle }));
    expect(r.rowsUpserted).toBe(2 + 4 + 2 + 2 + 2);
    await withTenant({ userId, organizationId: orgId }, async (tx) => {
      const totals = await ga4OrganicTotals(tx, projectId, "2026-09-01", "2026-09-02");
      expect(totals).toMatchObject({ users: 80, sessions: 110, engagedSessions: 70, conversions: 4, revenue: 39, days: 2 });
      const channels = await tx.select().from(schema.ga4Metrics).where(and(eq(schema.ga4Metrics.projectId, projectId), eq(schema.ga4Metrics.dimension, "channel")));
      expect(new Set(channels.map((c) => c.channelGroup))).toEqual(new Set(["Organic Search", "Direct"]));
      expect(channels[0]!.bounceRate).toBeCloseTo(0.36);
      const c = await getGa4Connection(tx, projectId);
      expect(c!.lastSyncedAt).not.toBeNull();
      expect(await usageTotal(tx, orgId, "ga4_syncs", new Date(Date.now() - 3600_000))).toBe(1);
    });
  });
});

describe("PageSpeed", () => {
  it("persists successful and failed runs (null scores) and meters pagespeed_calls", async () => {
    const ok = parsePsiResponse("https://own.example/", "mobile", { id: "req-1", lighthouseResult: { lighthouseVersion: "12.6.0", categories: { performance: { score: 0.71 } }, audits: { "largest-contentful-paint": { numericValue: 2400 } } } });
    const failed = { ...parsePsiResponse("https://own.example/broken", "mobile", {}), errorMessage: "Lighthouse returned error: ERR_CONNECTION_REFUSED" };
    await withTenant({ userId, organizationId: orgId }, async (tx) => {
      await persistPageSpeed(tx, { projectId, organizationId: orgId, result: ok });
      await persistPageSpeed(tx, { projectId, organizationId: orgId, result: failed });
      const latest = await latestPageSpeed(tx, projectId, "https://own.example/", "mobile");
      expect(latest).toMatchObject({ performanceScore: 71, lcpMs: 2400, accessibilityScore: null, providerRequestId: "req-1", errorMessage: null });
      const broken = await latestPageSpeed(tx, projectId, "https://own.example/broken", "mobile");
      expect(broken!.performanceScore).toBeNull();
      expect(broken!.errorMessage).toContain("ERR_CONNECTION_REFUSED");
      expect(await usageTotal(tx, orgId, "pagespeed_calls", new Date(Date.now() - 3600_000))).toBe(2);
    });
  });
});

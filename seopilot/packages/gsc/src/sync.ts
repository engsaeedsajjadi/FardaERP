/**
 * GSC sync (worker GSC_SYNC job). Pulls daily rows for the configured
 * dimension sets and upserts into gsc_metrics keyed by (project, date,
 * dimension, keyHash). GSC data is final ~2–3 days behind; we always re-pull
 * the last 5 days to pick up late finalisation.
 */
import { and, desc, eq, gte, lte, schema, sql, type Transaction } from "@seopilot/db";
import { AppError, sha256 } from "@seopilot/shared";
import { recordUsage } from "@seopilot/usage";
import { GscClient, type SearchAnalyticsRow } from "./client";
import { encryptTokens, getAccessToken, type FetchLike } from "./google-oauth";

export const GSC_DIMENSION_SETS: Record<string, string[]> = {
  date: ["date"],
  query: ["date", "query"],
  page: ["date", "page"],
  query_page: ["date", "query", "page"],
  country: ["date", "country"],
  device: ["date", "device"],
  search_appearance: ["date", "searchAppearance"],
};

const ROW_LIMITS: Record<string, number> = { date: 1000, query: 25000, page: 25000, query_page: 50000, country: 5000, device: 100, search_appearance: 1000 };

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function connectGsc(tx: Transaction, input: { projectId: string; organizationId: string; userId: string; siteUrl: string; permissionLevel: string | null; email: string | null; refreshToken: string; accessToken: string; expiresAt: Date; scopes: string[] }) {
  const aad = `gsc:${input.projectId}`;
  const enc = encryptTokens({ refreshToken: input.refreshToken, accessToken: input.accessToken, expiresAt: input.expiresAt }, aad);
  const [row] = await tx
    .insert(schema.gscConnections)
    .values({ projectId: input.projectId, organizationId: input.organizationId, googleAccountEmail: input.email, siteUrl: input.siteUrl, permissionLevel: input.permissionLevel, ...enc, scopes: input.scopes, status: "connected", connectedBy: input.userId })
    .onConflictDoUpdate({ target: schema.gscConnections.projectId, set: { googleAccountEmail: input.email, siteUrl: input.siteUrl, permissionLevel: input.permissionLevel, ...enc, scopes: input.scopes, status: "connected", lastSyncError: null, connectedBy: input.userId, updatedAt: new Date() } })
    .returning({ id: schema.gscConnections.id });
  return row!.id;
}

export async function disconnectGsc(tx: Transaction, projectId: string): Promise<void> {
  await tx.update(schema.gscConnections).set({ status: "disconnected", updatedAt: new Date() }).where(eq(schema.gscConnections.projectId, projectId));
}

export async function getGscConnection(tx: Transaction, projectId: string) {
  const [c] = await tx.select().from(schema.gscConnections).where(eq(schema.gscConnections.projectId, projectId)).limit(1);
  return c ?? null;
}

export async function gscClientFor(tx: Transaction, projectId: string, fetchImpl: FetchLike = fetch): Promise<{ client: GscClient; connection: NonNullable<Awaited<ReturnType<typeof getGscConnection>>> }> {
  const connection = await getGscConnection(tx, projectId);
  if (!connection || connection.status === "disconnected") throw new AppError("PROVIDER_NOT_CONFIGURED", "Google Search Console is not connected for this project", { provider: "gsc" }, { reportable: false });
  const token = await getAccessToken(connection, `gsc:${projectId}`, async (next) => {
    await tx.update(schema.gscConnections).set({ ...next, updatedAt: new Date() }).where(eq(schema.gscConnections.id, connection.id));
  }, fetchImpl);
  return { client: new GscClient(token, fetchImpl), connection };
}

function keyOf(dimension: string, row: SearchAnalyticsRow): { query: string | null; page: string | null; country: string | null; device: string | null; searchAppearance: string | null; keyHash: string } {
  const dims = GSC_DIMENSION_SETS[dimension] ?? ["date"];
  const get = (name: string) => {
    const i = dims.indexOf(name);
    return i >= 0 ? (row.keys[i] ?? null) : null;
  };
  const out = { query: get("query"), page: get("page"), country: get("country"), device: get("device"), searchAppearance: get("searchAppearance") };
  return { ...out, keyHash: sha256(JSON.stringify([out.query, out.page, out.country, out.device, out.searchAppearance])) };
}

export interface GscSyncResult {
  rowsUpserted: number;
  from: string;
  to: string;
  dimensions: string[];
}

export async function syncGsc(tx: Transaction, input: { projectId: string; organizationId: string; dimensions?: string[]; lookbackDays?: number; fetchImpl?: FetchLike }): Promise<GscSyncResult> {
  const { client, connection } = await gscClientFor(tx, input.projectId, input.fetchImpl);
  const dimensions = input.dimensions ?? ["date", "query", "page", "country", "device"];
  const to = new Date(Date.now() - 2 * 86_400_000); // GSC finalises ~2 days late
  const lastSync = connection.lastSyncedAt;
  const lookback = input.lookbackDays ?? (lastSync ? 5 : 90);
  const from = new Date(to.getTime() - lookback * 86_400_000);
  let rowsUpserted = 0;
  for (const dimension of dimensions) {
    const dims = GSC_DIMENSION_SETS[dimension];
    if (!dims) continue;
    const rows = await client.searchAnalyticsAll(connection.siteUrl, { startDate: isoDay(from), endDate: isoDay(to), dimensions: dims, type: "web" }, ROW_LIMITS[dimension] ?? 25000);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => {
        const k = keyOf(dimension, r);
        return { projectId: input.projectId, organizationId: input.organizationId, connectionId: connection.id, date: r.keys[0] as string, dimension, ...k, searchType: "web", clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position };
      });
      if (!chunk.length) continue;
      await tx
        .insert(schema.gscMetrics)
        .values(chunk)
        .onConflictDoUpdate({ target: [schema.gscMetrics.projectId, schema.gscMetrics.date, schema.gscMetrics.dimension, schema.gscMetrics.keyHash], set: { clicks: sql`excluded.clicks`, impressions: sql`excluded.impressions`, ctr: sql`excluded.ctr`, position: sql`excluded.position`, fetchedAt: new Date() } });
      rowsUpserted += chunk.length;
    }
  }
  await tx.update(schema.gscConnections).set({ lastSyncedAt: new Date(), lastSyncError: null, updatedAt: new Date() }).where(eq(schema.gscConnections.id, connection.id));
  await recordUsage(tx, { organizationId: input.organizationId, projectId: input.projectId, metric: "gsc_syncs", quantity: 1, provider: "google" });
  return { rowsUpserted, from: isoDay(from), to: isoDay(to), dimensions };
}

/**
 * Record a sync failure. Must be called by the worker in a FRESH transaction
 * (the failing sync's transaction is rolled back). Auth failures flip the
 * connection to needs_reauth so the UI can prompt for reconnection.
 */
export async function recordGscFailure(tx: Transaction, projectId: string, err: unknown): Promise<void> {
  const authFailed = err instanceof AppError && err.code === "PROVIDER_AUTH_FAILED";
  const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
  await tx.update(schema.gscConnections).set({ lastSyncError: message, ...(authFailed ? { status: "needs_reauth" as const } : {}), updatedAt: new Date() }).where(eq(schema.gscConnections.projectId, projectId));
}

export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  days: number;
}

export async function gscTotals(tx: Transaction, projectId: string, from: string, to: string): Promise<GscTotals> {
  const [row] = await tx
    .select({ clicks: sql<number>`COALESCE(SUM(${schema.gscMetrics.clicks}),0)::int`, impressions: sql<number>`COALESCE(SUM(${schema.gscMetrics.impressions}),0)::int`, position: sql<number | null>`CASE WHEN SUM(${schema.gscMetrics.impressions}) > 0 THEN SUM(${schema.gscMetrics.position} * ${schema.gscMetrics.impressions}) / SUM(${schema.gscMetrics.impressions}) ELSE NULL END`, days: sql<number>`COUNT(*)::int` })
    .from(schema.gscMetrics)
    .where(and(eq(schema.gscMetrics.projectId, projectId), eq(schema.gscMetrics.dimension, "date"), gte(schema.gscMetrics.date, from), lte(schema.gscMetrics.date, to)));
  const clicks = Number(row?.clicks ?? 0), impressions = Number(row?.impressions ?? 0);
  return { clicks, impressions, ctr: impressions ? clicks / impressions : null, position: row?.position === null || row?.position === undefined ? null : Number(row.position), days: Number(row?.days ?? 0) };
}

export async function gscTop(tx: Transaction, projectId: string, dimension: "query" | "page" | "country" | "device", from: string, to: string, limit = 100) {
  const col = dimension === "query" ? schema.gscMetrics.query : dimension === "page" ? schema.gscMetrics.page : dimension === "country" ? schema.gscMetrics.country : schema.gscMetrics.device;
  return tx
    .select({ key: col, clicks: sql<number>`SUM(${schema.gscMetrics.clicks})::int`, impressions: sql<number>`SUM(${schema.gscMetrics.impressions})::int`, position: sql<number>`SUM(${schema.gscMetrics.position} * ${schema.gscMetrics.impressions}) / NULLIF(SUM(${schema.gscMetrics.impressions}),0)` })
    .from(schema.gscMetrics)
    .where(and(eq(schema.gscMetrics.projectId, projectId), eq(schema.gscMetrics.dimension, dimension), gte(schema.gscMetrics.date, from), lte(schema.gscMetrics.date, to)))
    .groupBy(col)
    .orderBy(desc(sql`SUM(${schema.gscMetrics.clicks})`))
    .limit(limit);
}

/** Opportunity finders based purely on the project's own GSC data. */
export async function gscOpportunities(tx: Transaction, projectId: string, from: string, to: string) {
  const queries = await gscTop(tx, projectId, "query", from, to, 5000);
  const strikingDistance = queries.filter((q) => q.position !== null && q.position >= 8 && q.position <= 20 && q.impressions >= 50).slice(0, 100);
  const lowCtr = queries.filter((q) => q.position !== null && q.position <= 5 && q.impressions >= 100 && q.clicks / q.impressions < 0.02).slice(0, 100);
  const pages = await gscTop(tx, projectId, "page", from, to, 5000);
  const decayingCandidates = pages.slice(0, 500);
  return { strikingDistance, lowCtr, topPages: decayingCandidates.slice(0, 100) };
}

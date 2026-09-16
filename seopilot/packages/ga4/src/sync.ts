import { and, eq, gte, lte, schema, sql, type Transaction } from "@seopilot/db";
import { encryptTokens, getAccessToken, isoDay, type FetchLike } from "@seopilot/gsc";
import { AppError } from "@seopilot/shared";
import { recordUsage } from "@seopilot/usage";
import { Ga4Client, ORGANIC_FILTER } from "./client";

const METRICS = ["totalUsers", "newUsers", "sessions", "engagedSessions", "conversions", "totalRevenue", "bounceRate", "averageSessionDuration"];

export async function connectGa4(tx: Transaction, input: { projectId: string; organizationId: string; userId: string; propertyId: string; propertyName: string | null; email: string | null; refreshToken: string; accessToken: string; expiresAt: Date }) {
  const enc = encryptTokens({ refreshToken: input.refreshToken, accessToken: input.accessToken, expiresAt: input.expiresAt }, `ga4:${input.projectId}`);
  const [row] = await tx
    .insert(schema.ga4Connections)
    .values({ projectId: input.projectId, organizationId: input.organizationId, googleAccountEmail: input.email, propertyId: input.propertyId, propertyName: input.propertyName, ...enc, status: "connected", connectedBy: input.userId })
    .onConflictDoUpdate({ target: schema.ga4Connections.projectId, set: { googleAccountEmail: input.email, propertyId: input.propertyId, propertyName: input.propertyName, ...enc, status: "connected", lastSyncError: null, connectedBy: input.userId, updatedAt: new Date() } })
    .returning({ id: schema.ga4Connections.id });
  return row!.id;
}

export async function getGa4Connection(tx: Transaction, projectId: string) {
  const [c] = await tx.select().from(schema.ga4Connections).where(eq(schema.ga4Connections.projectId, projectId)).limit(1);
  return c ?? null;
}

export async function ga4ClientFor(tx: Transaction, projectId: string, fetchImpl: FetchLike = fetch) {
  const connection = await getGa4Connection(tx, projectId);
  if (!connection || connection.status === "disconnected") throw new AppError("PROVIDER_NOT_CONFIGURED", "Google Analytics 4 is not connected for this project", { provider: "ga4" }, { reportable: false });
  const token = await getAccessToken(connection, `ga4:${projectId}`, async (next) => {
    await tx.update(schema.ga4Connections).set({ ...next, updatedAt: new Date() }).where(eq(schema.ga4Connections.id, connection.id));
  }, fetchImpl);
  return { client: new Ga4Client(token, fetchImpl), connection };
}

/** Worker-side failure recording; call in a fresh transaction after a failed sync. */
export async function recordGa4Failure(tx: Transaction, projectId: string, err: unknown): Promise<void> {
  const authFailed = err instanceof AppError && err.code === "PROVIDER_AUTH_FAILED";
  const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
  await tx.update(schema.ga4Connections).set({ lastSyncError: message, ...(authFailed ? { status: "needs_reauth" as const } : {}), updatedAt: new Date() }).where(eq(schema.ga4Connections.projectId, projectId));
}

const DIMENSION_SETS: Record<string, { dims: string[]; organicOnly: boolean }> = {
  date: { dims: ["date"], organicOnly: true },
  channel: { dims: ["date", "sessionDefaultChannelGroup"], organicOnly: false },
  landing_page: { dims: ["date", "landingPagePlusQueryString"], organicOnly: true },
  device: { dims: ["date", "deviceCategory"], organicOnly: true },
  country: { dims: ["date", "country"], organicOnly: true },
};

export async function syncGa4(tx: Transaction, input: { projectId: string; organizationId: string; dimensions?: string[]; lookbackDays?: number; fetchImpl?: FetchLike }): Promise<{ rowsUpserted: number; from: string; to: string }> {
  const { client, connection } = await ga4ClientFor(tx, input.projectId, input.fetchImpl);
  const dimensions = input.dimensions ?? ["date", "channel", "landing_page", "device", "country"];
  const to = new Date(Date.now() - 86_400_000);
  const from = new Date(to.getTime() - (input.lookbackDays ?? (connection.lastSyncedAt ? 5 : 90)) * 86_400_000);
  let rowsUpserted = 0;
  for (const dimension of dimensions) {
    const set = DIMENSION_SETS[dimension];
    if (!set) continue;
    const report = await client.runReport(connection.propertyId, { startDate: isoDay(from), endDate: isoDay(to), dimensions: set.dims, metrics: METRICS, dimensionFilter: set.organicOnly ? ORGANIC_FILTER : undefined, limit: 50000 });
    const rows = report.rows.map((r) => {
      const d = r.dimensions[0] as string; // YYYYMMDD
      const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      const [users, newUsers, sessions, engaged, conversions, revenue, bounce, avgDur] = r.metrics;
      return { projectId: input.projectId, organizationId: input.organizationId, connectionId: connection.id, date, dimension, dimensionValue: dimension === "date" ? "all" : (r.dimensions[1] ?? null), channelGroup: dimension === "channel" ? (r.dimensions[1] ?? null) : "Organic Search", users: Math.round(users ?? 0), newUsers: Math.round(newUsers ?? 0), sessions: Math.round(sessions ?? 0), engagedSessions: Math.round(engaged ?? 0), conversions: conversions ?? 0, revenue: revenue ?? null, bounceRate: bounce ?? null, avgSessionDurationSec: avgDur ?? null };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await tx
        .insert(schema.ga4Metrics)
        .values(chunk)
        .onConflictDoUpdate({ target: [schema.ga4Metrics.projectId, schema.ga4Metrics.date, schema.ga4Metrics.dimension, schema.ga4Metrics.dimensionValue, schema.ga4Metrics.channelGroup], set: { users: sql`excluded.users`, newUsers: sql`excluded.new_users`, sessions: sql`excluded.sessions`, engagedSessions: sql`excluded.engaged_sessions`, conversions: sql`excluded.conversions`, revenue: sql`excluded.revenue`, bounceRate: sql`excluded.bounce_rate`, avgSessionDurationSec: sql`excluded.avg_session_duration_sec`, fetchedAt: new Date() } });
      rowsUpserted += chunk.length;
    }
  }
  await tx.update(schema.ga4Connections).set({ lastSyncedAt: new Date(), lastSyncError: null, updatedAt: new Date() }).where(eq(schema.ga4Connections.id, connection.id));
  await recordUsage(tx, { organizationId: input.organizationId, projectId: input.projectId, metric: "ga4_syncs", quantity: 1, provider: "google" });
  return { rowsUpserted, from: isoDay(from), to: isoDay(to) };
}

export async function ga4OrganicTotals(tx: Transaction, projectId: string, from: string, to: string) {
  const [row] = await tx
    .select({ users: sql<number>`COALESCE(SUM(${schema.ga4Metrics.users}),0)::int`, sessions: sql<number>`COALESCE(SUM(${schema.ga4Metrics.sessions}),0)::int`, engagedSessions: sql<number>`COALESCE(SUM(${schema.ga4Metrics.engagedSessions}),0)::int`, conversions: sql<number>`COALESCE(SUM(${schema.ga4Metrics.conversions}),0)`, revenue: sql<number | null>`SUM(${schema.ga4Metrics.revenue})`, days: sql<number>`COUNT(*)::int` })
    .from(schema.ga4Metrics)
    .where(and(eq(schema.ga4Metrics.projectId, projectId), eq(schema.ga4Metrics.dimension, "date"), gte(schema.ga4Metrics.date, from), lte(schema.ga4Metrics.date, to)));
  return { users: Number(row?.users ?? 0), sessions: Number(row?.sessions ?? 0), engagedSessions: Number(row?.engagedSessions ?? 0), conversions: Number(row?.conversions ?? 0), revenue: row?.revenue === null || row?.revenue === undefined ? null : Number(row.revenue), days: Number(row?.days ?? 0) };
}

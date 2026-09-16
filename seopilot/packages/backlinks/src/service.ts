import { and, desc, eq, inArray, schema, type Transaction } from "@seopilot/db";
import type { BacklinkProvider } from "@seopilot/providers";
import { consumeCredits, recordUsage } from "@seopilot/usage";

/** BACKLINK_REFRESH job: summary + up to `limit` backlinks, diffed against the previous set for new/lost detection. */
export async function refreshBacklinks(tx: Transaction, provider: BacklinkProvider, input: { projectId: string; organizationId: string; target: string; jobId: string; limit?: number }): Promise<{ snapshotId: string; newLinks: number; lostLinks: number; costUsd: number | null }> {
  const limit = Math.min(input.limit ?? 1000, 5000);
  await consumeCredits(tx, { organizationId: input.organizationId, projectId: input.projectId, operation: "backlinks.summary", provider: provider.name, referenceType: "job", referenceId: input.jobId, idempotencyKey: `bl-summary:${input.jobId}` });
  const summary = await provider.summary(input.target);
  let costUsd = summary.cost.costUsd;
  await consumeCredits(tx, { organizationId: input.organizationId, projectId: input.projectId, operation: "backlinks.list", quantity: limit, provider: provider.name, referenceType: "job", referenceId: input.jobId, idempotencyKey: `bl-list:${input.jobId}` });
  const list = await provider.backlinks(input.target, limit);
  if (list.cost.costUsd !== null) costUsd = (costUsd ?? 0) + list.cost.costUsd;
  await consumeCredits(tx, { organizationId: input.organizationId, projectId: input.projectId, operation: "backlinks.anchors", provider: provider.name, referenceType: "job", referenceId: input.jobId, idempotencyKey: `bl-anchors:${input.jobId}` });
  const anchors = await provider.anchors(input.target, 100);
  if (anchors.cost.costUsd !== null) costUsd = (costUsd ?? 0) + anchors.cost.costUsd;

  const existing = await tx.select({ id: schema.backlinks.id, sourceUrl: schema.backlinks.sourceUrl, targetUrl: schema.backlinks.targetUrl, isLost: schema.backlinks.isLost }).from(schema.backlinks).where(and(eq(schema.backlinks.projectId, input.projectId), eq(schema.backlinks.target, input.target)));
  const existingKey = new Map(existing.map((e) => [`${e.sourceUrl}→${e.targetUrl}`, e]));
  const seen = new Set<string>();
  let newLinks = 0;
  const now = new Date();
  for (const b of list.data) {
    const key = `${b.sourceUrl}→${b.targetUrl}`;
    seen.add(key);
    const prev = existingKey.get(key);
    if (!prev) newLinks++;
    await tx
      .insert(schema.backlinks)
      .values({ projectId: input.projectId, organizationId: input.organizationId, target: input.target, sourceUrl: b.sourceUrl, sourceDomain: b.sourceDomain, targetUrl: b.targetUrl, anchor: b.anchor, isDofollow: b.isDofollow, linkType: b.linkType, domainRank: b.domainRank, pageRank: b.pageRank, firstSeen: b.firstSeen ? new Date(b.firstSeen) : null, lastSeen: b.lastSeen ? new Date(b.lastSeen) : null, isLost: b.isLost, lostAt: b.isLost ? now : null, provider: list.provider, providerRequestId: list.cost.requestId })
      .onConflictDoUpdate({ target: [schema.backlinks.projectId, schema.backlinks.sourceUrl, schema.backlinks.targetUrl], set: { anchor: b.anchor, isDofollow: b.isDofollow, domainRank: b.domainRank, pageRank: b.pageRank, lastSeen: b.lastSeen ? new Date(b.lastSeen) : null, isLost: b.isLost, lostAt: b.isLost ? now : null, fetchedAt: now, providerRequestId: list.cost.requestId } });
  }
  // Links previously live that no longer appear in a full-size pull are marked lost (only when the pull was not truncated).
  let lostLinks = list.data.filter((b) => b.isLost).length;
  if (list.data.length < limit) {
    const gone = existing.filter((e) => !e.isLost && !seen.has(`${e.sourceUrl}→${e.targetUrl}`)).map((e) => e.id);
    if (gone.length) {
      await tx.update(schema.backlinks).set({ isLost: true, lostAt: now }).where(inArray(schema.backlinks.id, gone));
      lostLinks += gone.length;
    }
  }
  const [prevSnap] = await tx.select({ backlinks: schema.backlinkSnapshots.backlinks, fetchedAt: schema.backlinkSnapshots.fetchedAt }).from(schema.backlinkSnapshots).where(and(eq(schema.backlinkSnapshots.projectId, input.projectId), eq(schema.backlinkSnapshots.target, input.target))).orderBy(desc(schema.backlinkSnapshots.fetchedAt)).limit(1);
  void prevSnap;
  const [snap] = await tx
    .insert(schema.backlinkSnapshots)
    .values({ projectId: input.projectId, organizationId: input.organizationId, target: input.target, backlinks: summary.data.backlinks, referringDomains: summary.data.referringDomains, referringIps: summary.data.referringIps, dofollow: summary.data.dofollow, nofollow: summary.data.nofollow, domainRank: summary.data.domainRank, brokenBacklinks: summary.data.brokenBacklinks, newLast30: newLinks, lostLast30: lostLinks, anchors: anchors.data, provider: summary.provider, providerRequestId: summary.cost.requestId, costCredits: 20 })
    .returning({ id: schema.backlinkSnapshots.id });
  await recordUsage(tx, { organizationId: input.organizationId, projectId: input.projectId, metric: "backlink_calls", quantity: 3, provider: provider.name });
  return { snapshotId: snap!.id, newLinks, lostLinks, costUsd };
}

export async function latestBacklinkSnapshot(tx: Transaction, projectId: string, target: string) {
  const [s] = await tx.select().from(schema.backlinkSnapshots).where(and(eq(schema.backlinkSnapshots.projectId, projectId), eq(schema.backlinkSnapshots.target, target))).orderBy(desc(schema.backlinkSnapshots.fetchedAt)).limit(1);
  return s ?? null;
}

/** Anchor-text distribution with a simple over-optimisation flag (any single non-brand anchor > 30 %). */
export function anchorDistribution(anchors: Array<{ anchor: string; backlinks: number }>, brandTerms: string[]): { rows: Array<{ anchor: string; share: number; kind: "brand" | "generic" | "naked_url" | "exact" }>; overOptimized: string[] } {
  const total = anchors.reduce((a, r) => a + r.backlinks, 0) || 1;
  const generic = /^(click here|here|website|link|read more|this|source|more|visit)$/i;
  const rows = anchors.map((a) => {
    const t = a.anchor.trim().toLowerCase();
    const kind: "brand" | "generic" | "naked_url" | "exact" = brandTerms.some((b) => b && t.includes(b.toLowerCase())) ? "brand" : /^(https?:\/\/|www\.)/.test(t) ? "naked_url" : generic.test(t) || t === "" ? "generic" : "exact";
    return { anchor: a.anchor, share: Math.round((a.backlinks / total) * 1000) / 10, kind };
  });
  return { rows, overOptimized: rows.filter((r) => r.kind === "exact" && r.share > 30).map((r) => r.anchor) };
}

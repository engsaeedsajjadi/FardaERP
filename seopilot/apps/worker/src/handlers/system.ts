import { eq, schema, sql, withSystem } from "@seopilot/db";
import { processAlertsForOrganization, sendTransactionalEmail, type TemplateName } from "@seopilot/notifications";
import { decryptSecret, hmacSha256, resolveAndValidate } from "@seopilot/security";
import type { JobEnvelope, JobHandler } from "../types";

export const alertProcessing: JobHandler<JobEnvelope & { reason?: string }> = async (p, ctx) => {
  const r = await ctx.tx((tx) => processAlertsForOrganization(tx, p.organizationId));
  return { ...r, reason: p.reason ?? null };
};

export const emailDelivery: JobHandler<JobEnvelope & { to: string[]; template: TemplateName; data: Record<string, unknown> }> = async (p) => {
  const r = await sendTransactionalEmail({ to: p.to, template: p.template, data: p.data });
  if (r.status === "failed") throw new Error(r.error ?? "email failed");
  return { status: r.status };
};

/**
 * Signed webhook delivery with SSRF validation. Signature:
 *   X-SEOPilot-Signature: t=<unix>,v1=<hex hmac-sha256(secret, `${t}.${body}`)>
 * After 10 consecutive failures the endpoint is disabled (spec §40).
 */
export const webhookDelivery: JobHandler<JobEnvelope & { deliveryId: string }> = async (p, ctx) => {
  const d = await ctx.tx(async (tx) => {
    const [delivery] = await tx.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, p.deliveryId)).limit(1);
    if (!delivery) return null;
    const [hook] = await tx.select().from(schema.webhooks).where(eq(schema.webhooks.id, delivery.webhookId)).limit(1);
    return hook ? { delivery, hook } : null;
  });
  if (!d) return { skipped: "missing" };
  if (!d.hook.isEnabled) return { skipped: "disabled" };
  const body = JSON.stringify({ id: d.delivery.id, event: d.delivery.event, createdAt: d.delivery.createdAt.toISOString(), data: d.delivery.payload });
  const t = Math.floor(Date.now() / 1000);
  const sig = hmacSha256(decryptSecret(d.hook.encryptedSecret, d.hook.id), `${t}.${body}`);
  let status: number | null = null, snippet: string | null = null, error: string | null = null;
  try {
    await resolveAndValidate(d.hook.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(d.hook.url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "SEOPilot-Webhooks/1.0", "x-seopilot-event": d.delivery.event, "x-seopilot-delivery": d.delivery.id, "x-seopilot-signature": `t=${t},v1=${sig}` }, body, signal: controller.signal, redirect: "manual" });
    clearTimeout(timer);
    status = res.status;
    snippet = (await res.text().catch(() => "")).slice(0, 500);
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const attempt = d.delivery.attempt;
  const final = attempt >= 5;
  await ctx.tx(async (tx) => {
    await tx.update(schema.webhookDeliveries).set({ status: error ? (final ? "dead" : "failed") : "delivered", responseStatus: status, responseBodySnippet: snippet, error, deliveredAt: error ? null : new Date(), attempt: error && !final ? attempt + 1 : attempt, nextAttemptAt: error && !final ? new Date(Date.now() + 60_000 * 2 ** attempt) : null }).where(eq(schema.webhookDeliveries.id, d.delivery.id));
    if (error) {
      const [h] = await tx.update(schema.webhooks).set({ failureCount: sql`${schema.webhooks.failureCount} + 1`, updatedAt: new Date() }).where(eq(schema.webhooks.id, d.hook.id)).returning({ failureCount: schema.webhooks.failureCount });
      if ((h?.failureCount ?? 0) >= 10) await tx.update(schema.webhooks).set({ isEnabled: false, disabledReason: "10 consecutive delivery failures" }).where(eq(schema.webhooks.id, d.hook.id));
    } else {
      await tx.update(schema.webhooks).set({ failureCount: 0, lastDeliveredAt: new Date(), updatedAt: new Date() }).where(eq(schema.webhooks.id, d.hook.id));
    }
  });
  if (error && !final) throw new Error(`webhook delivery failed: ${error}`); // pg-boss retries with backoff
  return { status, error, final };
};

/** Hard-deletes an organization after its GDPR grace period (spec §45). Idempotent. */
export const orgDeletion: JobHandler<JobEnvelope> = async (p, ctx) => {
  const deleted = await withSystem(null, async (tx) => {
    const [org] = await tx.select({ id: schema.organizations.id, deletedAt: schema.organizations.deletedAt }).from(schema.organizations).where(eq(schema.organizations.id, p.organizationId)).limit(1);
    if (!org) return "already_deleted";
    if (!org.deletedAt) return "not_scheduled";
    if (org.deletedAt.getTime() > Date.now()) return "grace_period";
    await tx.delete(schema.organizations).where(eq(schema.organizations.id, p.organizationId)); // cascades
    return "deleted";
  });
  ctx.log.info({ organizationId: p.organizationId, deleted }, "org.deletion");
  return { result: deleted };
};

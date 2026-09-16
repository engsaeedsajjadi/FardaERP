import { and, eq, schema, withSystem } from "@seopilot/db";
import { decryptSecret } from "@seopilot/security";
import { logger } from "@seopilot/shared";
import { sendTransactionalEmail } from "./email";
import { sendDiscord, sendSlack, sendTelegram, type ChannelMessage } from "./channels";
import { DEFAULT_BRANDING, type Branding } from "./templates";

export type ChannelSpec = { type: "email" | "dashboard" | "webhook" | "slack" | "discord" | "telegram"; target?: string };

export interface NotifyInput {
  organizationId: string;
  projectId?: string | null;
  ruleId?: string | null;
  event: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
  channels: ChannelSpec[];
  /** Explicit recipients for email (member emails resolved by caller). */
  emailRecipients?: string[];
  branding?: Branding;
  userId?: string | null;
}

/** Persist a dashboard notification and deliver to every configured channel. Returns per-channel outcomes. */
export async function dispatchNotification(input: NotifyInput): Promise<{ notificationId: string; deliveries: Array<{ channel: string; target?: string; status: "sent" | "failed" | "skipped"; error?: string; at: string }> }> {
  const deliveries: Array<{ channel: string; target?: string; status: "sent" | "failed" | "skipped"; error?: string; at: string }> = [];
  const message: ChannelMessage = { title: input.title, body: input.body, url: input.url, severity: input.severity };
  const branding = input.branding ?? DEFAULT_BRANDING;

  for (const ch of input.channels) {
    const at = new Date().toISOString();
    try {
      switch (ch.type) {
        case "dashboard":
          deliveries.push({ channel: "dashboard", status: "sent", at });
          break;
        case "email": {
          const to = input.emailRecipients ?? [];
          if (to.length === 0) {
            deliveries.push({ channel: "email", status: "skipped", error: "no recipients", at });
            break;
          }
          const r = await sendTransactionalEmail({ to, template: "alert", data: { title: input.title, body: input.body, url: input.url }, branding });
          deliveries.push({ channel: "email", target: to.join(","), status: r.status === "sent" ? "sent" : r.status === "not_configured" ? "skipped" : "failed", error: r.error, at });
          break;
        }
        case "slack":
        case "discord":
        case "telegram": {
          const integ = await withSystem(input.organizationId, async (tx) => {
            if (!input.projectId) return null;
            const [row] = await tx.select().from(schema.projectIntegrations).where(and(eq(schema.projectIntegrations.projectId, input.projectId), eq(schema.projectIntegrations.kind, ch.type as "slack" | "discord" | "telegram"))).limit(1);
            return row ?? null;
          });
          if (!integ?.encryptedCredentials || integ.status !== "connected") {
            deliveries.push({ channel: ch.type, status: "skipped", error: "not connected", at });
            break;
          }
          const creds = JSON.parse(decryptSecret(integ.encryptedCredentials, integ.id)) as { webhookUrl?: string; botToken?: string; chatId?: string };
          const r = ch.type === "slack" && creds.webhookUrl ? await sendSlack(creds.webhookUrl, message)
            : ch.type === "discord" && creds.webhookUrl ? await sendDiscord(creds.webhookUrl, message)
            : ch.type === "telegram" && creds.botToken && creds.chatId ? await sendTelegram(creds.botToken, creds.chatId, message)
            : { status: "failed" as const, error: "incomplete credentials" };
          deliveries.push({ channel: ch.type, status: r.status, error: r.error, at });
          break;
        }
        case "webhook":
          // Outbound webhooks are delivered by the webhook subsystem (signed, retried); record intent here.
          deliveries.push({ channel: "webhook", status: "sent", at });
          break;
      }
    } catch (err) {
      deliveries.push({ channel: ch.type, status: "failed", error: err instanceof Error ? err.message : String(err), at });
    }
  }

  const notificationId = await withSystem(input.organizationId, async (tx) => {
    const [row] = await tx
      .insert(schema.notifications)
      .values({
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        userId: input.userId ?? null,
        ruleId: input.ruleId ?? null,
        event: input.event,
        severity: input.severity,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        deliveries,
      })
      .returning({ id: schema.notifications.id });
    return row?.id as string;
  });
  logger.info({ organizationId: input.organizationId, event: input.event, deliveries: deliveries.map((d) => `${d.channel}:${d.status}`) }, "notification.dispatched");
  return { notificationId, deliveries };
}

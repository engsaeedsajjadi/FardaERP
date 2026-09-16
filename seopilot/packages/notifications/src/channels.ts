/**
 * Outbound chat/webhook channels. All URLs are user-supplied and therefore go
 * through safeFetch (SSRF guard). Telegram uses the Bot API with a bot token
 * stored encrypted in the integration record.
 */
import { safeFetch } from "@seopilot/security";

export interface ChannelMessage {
  title: string;
  body: string;
  url?: string;
  severity: "info" | "warning" | "critical";
}

export interface ChannelResult {
  status: "sent" | "failed";
  error?: string;
  responseStatus?: number;
}

const SEVERITY_COLOR = { info: 0x2563eb, warning: 0xf59e0b, critical: 0xdc2626 } as const;

async function postJson(url: string, payload: unknown): Promise<ChannelResult> {
  try {
    const res = await safeFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "SEOPilot-Notifier/1.0" },
      body: JSON.stringify(payload),
      timeoutMs: 10_000,
      maxBytes: 64 * 1024,
      policy: { allowHttp: false },
    });
    if (res.ok) return { status: "sent", responseStatus: res.status };
    return { status: "failed", responseStatus: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export function sendSlack(webhookUrl: string, m: ChannelMessage): Promise<ChannelResult> {
  const emoji = m.severity === "critical" ? ":rotating_light:" : m.severity === "warning" ? ":warning:" : ":information_source:";
  return postJson(webhookUrl, {
    text: `${emoji} *${m.title}*\n${m.body}${m.url ? `\n<${m.url}|Open in dashboard>` : ""}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${emoji} *${m.title}*\n${m.body}` } },
      ...(m.url ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open dashboard" }, url: m.url }] }] : []),
    ],
  });
}

export function sendDiscord(webhookUrl: string, m: ChannelMessage): Promise<ChannelResult> {
  return postJson(webhookUrl, { embeds: [{ title: m.title, description: m.body, url: m.url, color: SEVERITY_COLOR[m.severity] }] });
}

export function sendTelegram(botToken: string, chatId: string, m: ChannelMessage): Promise<ChannelResult> {
  const text = `<b>${escapeHtml(m.title)}</b>\n${escapeHtml(m.body)}${m.url ? `\n<a href="${m.url}">Open dashboard</a>` : ""}`;
  return postJson(`https://api.telegram.org/bot${botToken}/sendMessage`, { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

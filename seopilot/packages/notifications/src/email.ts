import nodemailer, { type Transporter } from "nodemailer";
import { readEnv, emailEnvSchema, logger, notConfigured } from "@seopilot/shared";
import { renderTemplate, DEFAULT_BRANDING, type Branding, type TemplateName } from "./templates";

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  const env = readEnv(emailEnvSchema);
  return Boolean(env.SMTP_HOST && env.EMAIL_FROM);
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const env = readEnv(emailEnvSchema);
  if (!env.SMTP_HOST || !env.EMAIL_FROM) throw notConfigured("SMTP email");
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? (env.SMTP_SECURE ? 465 : 587),
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } : undefined,
    pool: true,
    maxConnections: 3,
  });
  return transporter;
}

export interface SendEmailInput {
  to: string | string[];
  template: TemplateName;
  data: Record<string, unknown>;
  branding?: Branding;
  /** White-label sender override (validated by the caller against verified domains). */
  from?: { name?: string | null; address?: string | null } | null;
  replyTo?: string | null;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export interface SendEmailResult {
  status: "sent" | "not_configured" | "failed";
  messageId?: string;
  error?: string;
}

/** Transactional send. Never throws for "not configured": returns an explicit state the caller must surface. */
export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const env = readEnv(emailEnvSchema);
  if (!isEmailConfigured()) {
    logger.warn({ template: input.template }, "email.not_configured");
    return { status: "not_configured", error: "SMTP is not configured (SMTP_HOST / EMAIL_FROM)" };
  }
  const branding = input.branding ?? DEFAULT_BRANDING;
  const rendered = renderTemplate(input.template, input.data, branding);
  const fromAddress = input.from?.address ?? env.EMAIL_FROM;
  const fromName = input.from?.name ?? branding.companyName;
  try {
    const info = await getTransporter().sendMail({
      from: `"${fromName.replace(/"/g, "")}" <${fromAddress}>`,
      to: input.to,
      replyTo: input.replyTo ?? undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments: input.attachments,
    });
    logger.info({ template: input.template, messageId: info.messageId }, "email.sent");
    return { status: "sent", messageId: info.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ template: input.template, err: message }, "email.failed");
    return { status: "failed", error: message };
  }
}

/** Verify SMTP connectivity (admin panel provider health). */
export async function verifyEmailTransport(): Promise<{ ok: boolean; error?: string }> {
  if (!isEmailConfigured()) return { ok: false, error: "not configured" };
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

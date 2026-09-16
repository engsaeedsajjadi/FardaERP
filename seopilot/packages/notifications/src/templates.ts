/** Minimal, dependency-free HTML email templates with white-label branding hooks. */
export interface Branding {
  companyName: string;
  primaryColor: string;
  logoUrl?: string | null;
  footer?: string | null;
  hidePoweredBy?: boolean;
}

export const DEFAULT_BRANDING: Branding = { companyName: process.env.APP_NAME ?? "SEOPilot", primaryColor: "#2563eb", logoUrl: null, footer: null, hidePoweredBy: false };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function layout(branding: Branding, title: string, bodyHtml: string): string {
  const logo = branding.logoUrl ? `<img src="${esc(branding.logoUrl)}" alt="${esc(branding.companyName)}" style="max-height:40px" />` : `<strong style="font-size:18px;color:${esc(branding.primaryColor)}">${esc(branding.companyName)}</strong>`;
  const powered = branding.hidePoweredBy ? "" : `<p style="color:#94a3b8;font-size:12px">Powered by SEOPilot</p>`;
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:12px;border:1px solid #e2e8f0"><tr><td style="padding:32px">
<div style="margin-bottom:24px">${logo}</div>
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
${bodyHtml}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px" />
${branding.footer ? `<p style="color:#64748b;font-size:12px">${esc(branding.footer)}</p>` : ""}
${powered}
</td></tr></table></td></tr></table></body></html>`;
}

export function button(url: string, label: string, color: string): string {
  return `<p style="margin:24px 0"><a href="${esc(url)}" style="display:inline-block;background:${esc(color)};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(label)}</a></p><p style="color:#64748b;font-size:12px;word-break:break-all">If the button does not work, copy this link: ${esc(url)}</p>`;
}

export type TemplateName = "verify_email" | "verify_email_change" | "reset_password" | "two_factor_otp" | "team_invitation" | "alert" | "report_ready" | "credit_low" | "payment_failed" | "data_export_ready" | "generic";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderTemplate(name: TemplateName, data: Record<string, unknown>, branding: Branding = DEFAULT_BRANDING): RenderedEmail {
  const c = branding.primaryColor;
  const s = (k: string) => String(data[k] ?? "");
  switch (name) {
    case "verify_email":
      return { subject: `Verify your ${branding.companyName} email`, html: layout(branding, "Confirm your email address", `<p>Hi ${esc(s("name"))},</p><p>Confirm your email to activate your account.</p>${button(s("url"), "Verify email", c)}`), text: `Verify your email: ${s("url")}` };
    case "verify_email_change":
      return { subject: `Confirm your new email address`, html: layout(branding, "Confirm email change", `<p>Hi ${esc(s("name"))},</p><p>Confirm this new address for your account.</p>${button(s("url"), "Confirm", c)}`), text: `Confirm email change: ${s("url")}` };
    case "reset_password":
      return { subject: `Reset your ${branding.companyName} password`, html: layout(branding, "Reset your password", `<p>Hi ${esc(s("name"))},</p><p>We received a request to reset your password. This link expires in one hour. If you did not request it, ignore this email.</p>${button(s("url"), "Reset password", c)}`), text: `Reset your password: ${s("url")}` };
    case "two_factor_otp":
      return { subject: `Your ${branding.companyName} verification code`, html: layout(branding, "Your verification code", `<p>Hi ${esc(s("name"))},</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${esc(s("otp"))}</p><p>This code expires shortly.</p>`), text: `Your verification code: ${s("otp")}` };
    case "team_invitation":
      return { subject: `${esc(s("inviterName"))} invited you to ${esc(s("organizationName"))}`, html: layout(branding, `Join ${s("organizationName")}`, `<p>${esc(s("inviterName"))} invited you to join <strong>${esc(s("organizationName"))}</strong> as <em>${esc(s("role"))}</em>.</p>${button(s("url"), "Accept invitation", c)}<p style="color:#64748b;font-size:12px">This invitation expires on ${esc(s("expiresAt"))}.</p>`), text: `Accept invitation: ${s("url")}` };
    case "alert":
      return { subject: `[${branding.companyName}] ${s("title")}`, html: layout(branding, s("title"), `<p>${esc(s("body"))}</p>${data["url"] ? button(s("url"), "Open dashboard", c) : ""}`), text: `${s("title")}\n\n${s("body")}\n${s("url")}` };
    case "report_ready":
      return { subject: `Your report is ready: ${s("title")}`, html: layout(branding, "Report ready", `<p>The report <strong>${esc(s("title"))}</strong> for ${esc(s("projectName"))} has been generated.</p>${button(s("url"), "View report", c)}${data["expiresAt"] ? `<p style="color:#64748b;font-size:12px">Link expires ${esc(s("expiresAt"))}.</p>` : ""}`), text: `Report ready: ${s("url")}` };
    case "credit_low":
      return { subject: `Credit balance is low (${s("balance")} left)`, html: layout(branding, "Low credit balance", `<p>Your organization <strong>${esc(s("organizationName"))}</strong> has ${esc(s("balance"))} credits remaining. Scheduled rank checks and AI features pause when the balance reaches zero.</p>${button(s("url"), "Manage billing", c)}`), text: `Low credits: ${s("balance")}. ${s("url")}` };
    case "payment_failed":
      return { subject: `Payment failed for ${s("organizationName")}`, html: layout(branding, "Payment failed", `<p>We could not process your latest payment. Please update your payment method before ${esc(s("graceUntil"))} to avoid interruption.</p>${button(s("url"), "Update payment method", c)}`), text: `Payment failed. Update: ${s("url")}` };
    case "data_export_ready":
      return { subject: `Your data export is ready`, html: layout(branding, "Data export ready", `<p>Your requested data export is ready for download. The link expires ${esc(s("expiresAt"))}.</p>${button(s("url"), "Download export", c)}`), text: `Download export: ${s("url")}` };
    default:
      return { subject: s("subject") || branding.companyName, html: layout(branding, s("title") || s("subject"), `<p>${esc(s("body"))}</p>`), text: s("body") };
  }
}

/**
 * Security headers (spec §47). Applied by Next.js middleware/config; kept here
 * so the worker's health endpoint and tests reuse the same policy.
 */
export interface SecurityHeaderOptions {
  /** Extra origins allowed for connect-src / img-src (e.g. PostHog, Sentry). */
  connectSrc?: string[];
  imgSrc?: string[];
  /** Development enables unsafe-eval for React Fast Refresh. */
  dev?: boolean;
  nonce?: string;
}

export function buildContentSecurityPolicy(opts: SecurityHeaderOptions = {}): string {
  const scriptSrc = ["'self'"];
  if (opts.nonce) scriptSrc.push(`'nonce-${opts.nonce}'`, "'strict-dynamic'");
  if (opts.dev) scriptSrc.push("'unsafe-eval'", "'unsafe-inline'");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:", ...(opts.imgSrc ?? [])],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(opts.connectSrc ?? []), ...(opts.dev ? ["ws:", "wss:"] : [])],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "upgrade-insecure-requests": [],
  };
  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");
}

export function securityHeaders(opts: SecurityHeaderOptions = {}): Record<string, string> {
  return {
    "Content-Security-Policy": buildContentSecurityPolicy(opts),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
    ...(opts.dev ? {} : { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" }),
  };
}

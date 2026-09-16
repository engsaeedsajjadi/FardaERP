/**
 * Secret redaction for logs and error payloads. Applied by the logger and by
 * the provider-call log before anything is persisted.
 */
const SENSITIVE_KEY = /(password|passwd|secret|token|api[-_]?key|authorization|cookie|set-cookie|private[-_]?key|client[-_]?secret|access[-_]?key|refresh[-_]?token|credential|signature|stripe[-_]?signature)/i;

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bsk_(live|test)_[A-Za-z0-9]{8,}\b/g, // Stripe secret
  /\bwhsec_[A-Za-z0-9]{8,}\b/g, // Stripe webhook secret
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI / Anthropic-like keys
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google API key
  /\bya29\.[0-9A-Za-z_-]+\b/g, // Google OAuth access token
  /\b1\/\/[0-9A-Za-z_-]{20,}\b/g, // Google refresh token
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{10,}/gi,
  /\bspk_[A-Za-z0-9]{8,}\b/g, // SEOPilot API keys
];

export const REDACTED = "[REDACTED]";

export function redactString(input: string): string {
  let out = input;
  for (const re of SENSITIVE_VALUE_PATTERNS) out = out.replace(re, REDACTED);
  // Credentials embedded in URLs: scheme://user:pass@host
  out = out.replace(/(\w+:\/\/)([^\s/:@]+):([^\s/@]+)@/g, `$1$2:${REDACTED}@`);
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value && typeof value === "object") {
    if (value instanceof Error) {
      return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined } as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

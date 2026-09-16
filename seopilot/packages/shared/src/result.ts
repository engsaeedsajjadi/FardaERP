/**
 * Explicit provider result states (spec §60): a provider call is either data,
 * "not configured", or a failure. UI layers render each state honestly.
 */
export type ProviderResult<T> =
  | { status: "ok"; data: T; provider: string; requestId?: string | null; fetchedAt: Date }
  | { status: "not_configured"; provider: string; reason: string }
  | { status: "error"; provider: string; code: string; message: string; retryable: boolean; requestId?: string | null };

export function ok<T>(provider: string, data: T, requestId?: string | null): ProviderResult<T> {
  return { status: "ok", data, provider, requestId: requestId ?? null, fetchedAt: new Date() };
}

export function notConfiguredResult<T>(provider: string, reason: string): ProviderResult<T> {
  return { status: "not_configured", provider, reason };
}

export function providerError<T>(provider: string, code: string, message: string, retryable = false, requestId?: string | null): ProviderResult<T> {
  return { status: "error", provider, code, message, retryable, requestId: requestId ?? null };
}

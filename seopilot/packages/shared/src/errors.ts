/**
 * Application error taxonomy. Every thrown error that can reach an HTTP or MCP
 * boundary is an AppError so the boundary can map it to a status code without
 * leaking internals.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PLAN_LIMIT_REACHED"
  | "INSUFFICIENT_CREDITS"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "PROVIDER_AUTH_FAILED"
  | "UPSTREAM_UNAVAILABLE"
  | "SSRF_BLOCKED"
  | "PAYLOAD_TOO_LARGE"
  | "FEATURE_DISABLED"
  | "INTERNAL_ERROR";

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PLAN_LIMIT_REACHED: 402,
  INSUFFICIENT_CREDITS: 402,
  PROVIDER_NOT_CONFIGURED: 424,
  PROVIDER_ERROR: 502,
  PROVIDER_AUTH_FAILED: 502,
  UPSTREAM_UNAVAILABLE: 503,
  SSRF_BLOCKED: 400,
  PAYLOAD_TOO_LARGE: 413,
  FEATURE_DISABLED: 403,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  /** When false, the error is a normal product state (e.g. not configured) and should not be reported to Sentry. */
  readonly reportable: boolean;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>, options?: { cause?: unknown; reportable?: boolean }) {
    super(message ?? code, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = details;
    this.reportable = options?.reportable ?? (code === "INTERNAL_ERROR" || code === "PROVIDER_ERROR");
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } } {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Error) return new AppError("INTERNAL_ERROR", "Internal error", undefined, { cause: e });
  return new AppError("INTERNAL_ERROR", "Internal error");
}

export function notConfigured(provider: string): AppError {
  return new AppError("PROVIDER_NOT_CONFIGURED", `${provider} is not configured`, { provider }, { reportable: false });
}

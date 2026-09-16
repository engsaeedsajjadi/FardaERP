import pino, { type Logger } from "pino";
import { redact } from "./redact";

/**
 * Structured JSON logger. Every log line carries the correlation fields the
 * spec requires (requestId, jobId, organizationId, projectId, providerRequestId)
 * when they are bound via `child()`.
 */
const root: Logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "seopilot" },
  formatters: {
    level: (label) => ({ level: label }),
    log: (obj) => redact(obj),
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.secret",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.apiKey",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type LogContext = {
  requestId?: string;
  jobId?: string;
  organizationId?: string;
  projectId?: string;
  userId?: string;
  provider?: string;
  providerRequestId?: string;
  [key: string]: unknown;
};

export const logger = root;

export function childLogger(ctx: LogContext): Logger {
  return root.child(ctx);
}

export type { Logger };

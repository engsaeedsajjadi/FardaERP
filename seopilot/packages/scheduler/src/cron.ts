import { Cron } from "croner";
import { AppError } from "@seopilot/shared";

export type Frequency = "hourly" | "daily" | "weekly" | "monthly" | "custom";

/** Deterministic cron for the built-in frequencies; hour/minute chosen by the caller (spread load). */
export function cronForFrequency(freq: Exclude<Frequency, "custom">, opts: { minute?: number; hour?: number; weekday?: number; dayOfMonth?: number } = {}): string {
  const m = opts.minute ?? 0, h = opts.hour ?? 3;
  switch (freq) {
    case "hourly": return `${m} * * * *`;
    case "daily": return `${m} ${h} * * *`;
    case "weekly": return `${m} ${h} * * ${opts.weekday ?? 1}`;
    case "monthly": return `${m} ${h} ${opts.dayOfMonth ?? 1} * *`;
  }
}

export function validateCron(expr: string, timezone = "UTC"): void {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new AppError("VALIDATION_ERROR", "Cron expression must have 5 fields (minute hour day month weekday)");
  try {
    new Cron(expr, { timezone }).nextRun();
  } catch (err) {
    throw new AppError("VALIDATION_ERROR", `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Guard against sub-hourly schedules that would hammer providers.
  if (/^\*(\/[1-9]|\/[1-5][0-9])?\s/.test(expr) || /^\*\s/.test(expr)) throw new AppError("VALIDATION_ERROR", "Schedules more frequent than hourly are not allowed");
}

export function nextRun(expr: string, timezone = "UTC", after: Date = new Date()): Date | null {
  return new Cron(expr, { timezone }).nextRun(after);
}

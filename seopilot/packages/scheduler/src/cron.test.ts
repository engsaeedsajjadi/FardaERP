import { describe, expect, it } from "vitest";
import { cronForFrequency, nextRun, validateCron } from "./cron";
import { defaultIdempotencyKey, queueName } from "./jobs";

describe("cron helpers", () => {
  it("builds frequency crons and validates them", () => {
    expect(cronForFrequency("daily", { hour: 4, minute: 15 })).toBe("15 4 * * *");
    expect(cronForFrequency("weekly", { weekday: 5 })).toBe("0 3 * * 5");
    expect(() => validateCron("0 3 * * *")).not.toThrow();
    expect(() => validateCron("bad")).toThrowError(/5 fields/);
    expect(() => validateCron("*/5 * * * *")).toThrowError(/more frequent than hourly/);
    expect(() => validateCron("0 25 * * *")).toThrowError(/Invalid cron/);
  });
  it("computes next run in the schedule's timezone", () => {
    const after = new Date("2026-09-16T10:00:00Z");
    const n = nextRun("0 3 * * *", "Europe/Paris", after)!;
    expect(n.toISOString()).toBe("2026-09-17T01:00:00.000Z"); // 03:00 CEST = 01:00Z
  });
  it("derives queue names and singleton keys", () => {
    expect(queueName("SITE_CRAWL")).toBe("seopilot.site_crawl");
    expect(defaultIdempotencyKey({ type: "RANK_CHECK", organizationId: "o", projectId: "p" })).toBe("RANK_CHECK:p");
  });
});

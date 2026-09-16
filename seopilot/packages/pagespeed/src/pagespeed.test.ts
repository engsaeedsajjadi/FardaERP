import { beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@seopilot/shared";
import { cwvRating, pagespeedConfigured, parsePsiResponse, runPageSpeed, scoreCategory } from "./index";

const sample = {
  id: "https://example.com/",
  loadingExperience: { overall_category: "AVERAGE", metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12 }, INTERACTION_TO_NEXT_PAINT: { percentile: 180 } } },
  lighthouseResult: {
    lighthouseVersion: "12.6.0",
    finalDisplayedUrl: "https://example.com/",
    categories: { performance: { score: 0.63 }, accessibility: { score: 0.9 }, "best-practices": { score: 1 }, seo: { score: 0.85 } },
    audits: {
      "largest-contentful-paint": { numericValue: 3120.4 },
      "cumulative-layout-shift": { numericValue: 0.04 },
      "interaction-to-next-paint": { numericValue: 210 },
      "server-response-time": { numericValue: 640 },
      "first-contentful-paint": { numericValue: 1500 },
      "total-blocking-time": { numericValue: 300 },
      "speed-index": { numericValue: 4100 },
      "render-blocking-resources": { title: "Eliminate render-blocking resources", score: 0.2, details: { type: "opportunity", overallSavingsMs: 900 } },
      "uses-optimized-images": { title: "Efficiently encode images", score: 1, details: { type: "opportunity", overallSavingsMs: 0 } },
    },
  },
};

beforeAll(() => {
  delete process.env.GOOGLE_PAGESPEED_API_KEY;
  resetEnvCache();
});

describe("pagespeed parsing", () => {
  it("extracts scores, lab & field metrics and ranked opportunities", () => {
    const r = parsePsiResponse("https://example.com/", "mobile", sample);
    expect(r).toMatchObject({ performanceScore: 63, accessibilityScore: 90, bestPracticesScore: 100, seoScore: 85, lcpMs: 3120, clsValue: 0.04, inpMs: 210, ttfbMs: 640, fieldLcpMs: 2900, fieldCls: 0.12, fieldInpMs: 180, fieldOverallCategory: "AVERAGE", lighthouseVersion: "12.6.0", errorMessage: null });
    expect(r.opportunities).toEqual([{ id: "render-blocking-resources", title: "Eliminate render-blocking resources", savingsMs: 900, savingsBytes: null }]);
  });

  it("returns nulls (never estimates) for missing data and reports runtime errors", () => {
    const r = parsePsiResponse("https://x/", "desktop", { lighthouseResult: { runtimeError: { code: "FAILED_DOCUMENT_REQUEST", message: "net::ERR_NAME_NOT_RESOLVED" } } });
    expect(r.performanceScore).toBeNull();
    expect(r.fieldLcpMs).toBeNull();
    expect(r.errorMessage).toContain("FAILED_DOCUMENT_REQUEST");
  });

  it("classifies scores and Core Web Vitals", () => {
    expect([scoreCategory(95), scoreCategory(60), scoreCategory(10), scoreCategory(null)]).toEqual(["good", "needs_improvement", "poor", "unknown"]);
    expect([cwvRating("lcp", 2000), cwvRating("lcp", 3000), cwvRating("inp", 600), cwvRating("cls", 0.05), cwvRating("cls", null)]).toEqual(["good", "needs_improvement", "poor", "good", "unknown"]);
  });
});

describe("runPageSpeed", () => {
  it("refuses private targets (SSRF) before calling Google", async () => {
    let called = false;
    const f = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
    await expect(runPageSpeed("http://127.0.0.1/", "mobile", { fetchImpl: f })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("calls PSI with all categories, records 400 failures as errored results and 429 as RATE_LIMITED", async () => {
    expect(pagespeedConfigured()).toBe(false);
    const seen: string[] = [];
    const ok = (async (u: string | URL | Request) => { seen.push(String(u)); return new Response(JSON.stringify(sample)); }) as typeof fetch;
    const r = await runPageSpeed("https://example.com/", "desktop", { fetchImpl: ok, env: { GOOGLE_PAGESPEED_API_KEY: "k123" } as NodeJS.ProcessEnv });
    expect(r.performanceScore).toBe(63);
    const u = new URL(seen[0]!);
    expect(u.searchParams.getAll("category")).toEqual(["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"]);
    expect(u.searchParams.get("key")).toBe("k123");
    expect(u.searchParams.get("strategy")).toBe("desktop");
    const bad = (async () => new Response(JSON.stringify({ error: { message: "Lighthouse returned error: ERR_CONNECTION_REFUSED" } }), { status: 400 })) as typeof fetch;
    const failed = await runPageSpeed("https://example.com/down", "mobile", { fetchImpl: bad });
    expect(failed.performanceScore).toBeNull();
    expect(failed.errorMessage).toContain("ERR_CONNECTION_REFUSED");
    const limited = (async () => new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 })) as typeof fetch;
    await expect(runPageSpeed("https://example.com/", "mobile", { fetchImpl: limited })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

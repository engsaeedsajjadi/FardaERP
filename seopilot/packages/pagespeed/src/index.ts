/**
 * Google PageSpeed Insights v5 runner. Works without an API key (shared quota,
 * ~1 req/s) but GOOGLE_PAGESPEED_API_KEY is strongly recommended. Failures are
 * persisted with null scores + errorMessage — never estimated.
 */
import { and, desc, eq, schema, type Transaction } from "@seopilot/db";
import { resolveAndValidate } from "@seopilot/security";
import { AppError } from "@seopilot/shared";
import { recordUsage } from "@seopilot/usage";

const PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export type Strategy = "mobile" | "desktop";
export type FetchLike = typeof fetch;

export interface PageSpeedResult {
  url: string;
  finalUrl: string | null;
  strategy: Strategy;
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  lcpMs: number | null;
  clsValue: number | null;
  inpMs: number | null;
  ttfbMs: number | null;
  fcpMs: number | null;
  tbtMs: number | null;
  speedIndexMs: number | null;
  fieldLcpMs: number | null;
  fieldCls: number | null;
  fieldInpMs: number | null;
  fieldOverallCategory: string | null;
  lighthouseVersion: string | null;
  providerRequestId: string | null;
  errorMessage: string | null;
  opportunities: Array<{ id: string; title: string; savingsMs: number | null; savingsBytes: number | null }>;
  raw: unknown;
}

export function scoreCategory(score: number | null): "good" | "needs_improvement" | "poor" | "unknown" {
  if (score === null || !Number.isFinite(score)) return "unknown";
  if (score >= 90) return "good";
  if (score >= 50) return "needs_improvement";
  return "poor";
}

/** Core Web Vitals thresholds (web.dev): LCP 2.5s/4s, INP 200/500ms, CLS 0.1/0.25. */
export function cwvRating(metric: "lcp" | "inp" | "cls", value: number | null): "good" | "needs_improvement" | "poor" | "unknown" {
  if (value === null || !Number.isFinite(value)) return "unknown";
  const [g, p] = metric === "lcp" ? [2500, 4000] : metric === "inp" ? [200, 500] : [0.1, 0.25];
  return value <= g ? "good" : value <= p ? "needs_improvement" : "poor";
}

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: unknown): number | null => (num(v) === null ? null : Math.round((v as number) * 100));

/** Pure parse of a PSI v5 response body (exported for tests). */
export function parsePsiResponse(url: string, strategy: Strategy, body: Json): PageSpeedResult {
  const lh = (body["lighthouseResult"] ?? {}) as Json;
  const cats = (lh["categories"] ?? {}) as Record<string, Json>;
  const audits = (lh["audits"] ?? {}) as Record<string, Json>;
  const a = (id: string) => num(audits[id]?.["numericValue"]);
  const ms = (id: string) => { const v = a(id); return v === null ? null : Math.round(v); };
  const field = ((body["loadingExperience"] ?? {}) as Json);
  const fm = (field["metrics"] ?? {}) as Record<string, Json>;
  const f = (id: string) => { const v = num(fm[id]?.["percentile"]); return v === null ? null : Math.round(v); };
  const opportunities: PageSpeedResult["opportunities"] = [];
  for (const [id, audit] of Object.entries(audits)) {
    const details = audit["details"] as Json | undefined;
    if (details?.["type"] !== "opportunity") continue;
    const score = num(audit["score"]);
    if (score !== null && score >= 0.9) continue;
    opportunities.push({ id, title: String(audit["title"] ?? id), savingsMs: num(details["overallSavingsMs"]), savingsBytes: num(details["overallSavingsBytes"]) });
  }
  opportunities.sort((x, y) => (y.savingsMs ?? 0) - (x.savingsMs ?? 0));
  const runtimeError = lh["runtimeError"] as Json | undefined;
  return {
    url,
    finalUrl: typeof lh["finalDisplayedUrl"] === "string" ? (lh["finalDisplayedUrl"] as string) : typeof lh["finalUrl"] === "string" ? (lh["finalUrl"] as string) : null,
    strategy,
    performanceScore: pct(cats["performance"]?.["score"]),
    accessibilityScore: pct(cats["accessibility"]?.["score"]),
    bestPracticesScore: pct(cats["best-practices"]?.["score"]),
    seoScore: pct(cats["seo"]?.["score"]),
    lcpMs: ms("largest-contentful-paint"),
    clsValue: a("cumulative-layout-shift"),
    inpMs: ms("interaction-to-next-paint"),
    ttfbMs: ms("server-response-time"),
    fcpMs: ms("first-contentful-paint"),
    tbtMs: ms("total-blocking-time"),
    speedIndexMs: ms("speed-index"),
    fieldLcpMs: f("LARGEST_CONTENTFUL_PAINT_MS"),
    fieldCls: f("CUMULATIVE_LAYOUT_SHIFT_SCORE") === null ? null : (f("CUMULATIVE_LAYOUT_SHIFT_SCORE") as number) / 100,
    fieldInpMs: f("INTERACTION_TO_NEXT_PAINT"),
    fieldOverallCategory: typeof field["overall_category"] === "string" ? (field["overall_category"] as string) : null,
    lighthouseVersion: typeof lh["lighthouseVersion"] === "string" ? (lh["lighthouseVersion"] as string) : null,
    providerRequestId: typeof body["id"] === "string" ? (body["id"] as string) : null,
    errorMessage: runtimeError && runtimeError["code"] && runtimeError["code"] !== "NO_ERROR" ? `${runtimeError["code"]}: ${runtimeError["message"] ?? ""}`.trim() : null,
    opportunities: opportunities.slice(0, 20),
    raw: body,
  };
}

export function pagespeedConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GOOGLE_PAGESPEED_API_KEY);
}

export async function runPageSpeed(url: string, strategy: Strategy, opts: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<PageSpeedResult> {
  await resolveAndValidate(url);
  const key = (opts.env ?? process.env).GOOGLE_PAGESPEED_API_KEY;
  const u = new URL(PSI_URL);
  u.searchParams.set("url", url);
  u.searchParams.set("strategy", strategy);
  for (const c of ["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"]) u.searchParams.append("category", c);
  if (key) u.searchParams.set("key", key);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  let res: Response;
  try {
    res = await fetchImpl(u.toString(), { signal: controller.signal, headers: { accept: "application/json" } });
  } catch (err) {
    clearTimeout(timer);
    throw new AppError("UPSTREAM_UNAVAILABLE", `PageSpeed Insights unreachable: ${err instanceof Error ? err.message : String(err)}`, { provider: "google_pagespeed" }, { reportable: false });
  }
  clearTimeout(timer);
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const e = body["error"] as Json | undefined;
    const msg = String(e?.["message"] ?? `HTTP ${res.status}`);
    if (res.status === 429) throw new AppError("RATE_LIMITED", `PageSpeed Insights quota exceeded: ${msg}`, { provider: "google_pagespeed" }, { reportable: false });
    if (res.status === 400 || res.status === 500) {
      // PSI reports unreachable/invalid target pages as 4xx/5xx with an error body; record as a failed run.
      return { ...parsePsiResponse(url, strategy, {}), errorMessage: msg.slice(0, 500) };
    }
    if (res.status === 403) throw new AppError("PROVIDER_AUTH_FAILED", `PageSpeed Insights: ${msg}`, { provider: "google_pagespeed" }, { reportable: false });
    throw new AppError("UPSTREAM_UNAVAILABLE", `PageSpeed Insights: ${msg}`, { provider: "google_pagespeed" }, { reportable: false });
  }
  return parsePsiResponse(url, strategy, body);
}

export async function persistPageSpeed(tx: Transaction, input: { projectId: string; organizationId: string; result: PageSpeedResult; rawStorageKey?: string | null }): Promise<string> {
  const r = input.result;
  const [row] = await tx
    .insert(schema.pagespeedResults)
    .values({ projectId: input.projectId, organizationId: input.organizationId, url: r.url, strategy: r.strategy, performanceScore: r.performanceScore, accessibilityScore: r.accessibilityScore, bestPracticesScore: r.bestPracticesScore, seoScore: r.seoScore, lcpMs: r.lcpMs, clsValue: r.clsValue, inpMs: r.inpMs, ttfbMs: r.ttfbMs, fcpMs: r.fcpMs, tbtMs: r.tbtMs, speedIndexMs: r.speedIndexMs, fieldLcpMs: r.fieldLcpMs, fieldCls: r.fieldCls, fieldInpMs: r.fieldInpMs, fieldOverallCategory: r.fieldOverallCategory, lighthouseVersion: r.lighthouseVersion, rawStorageKey: input.rawStorageKey ?? null, errorMessage: r.errorMessage, provider: "google_pagespeed", providerRequestId: r.providerRequestId })
    .returning({ id: schema.pagespeedResults.id });
  await recordUsage(tx, { organizationId: input.organizationId, projectId: input.projectId, metric: "pagespeed_calls", quantity: 1, provider: "google_pagespeed" });
  return row!.id;
}

export async function latestPageSpeed(tx: Transaction, projectId: string, url: string, strategy: Strategy) {
  const [row] = await tx.select().from(schema.pagespeedResults).where(and(eq(schema.pagespeedResults.projectId, projectId), eq(schema.pagespeedResults.url, url), eq(schema.pagespeedResults.strategy, strategy))).orderBy(desc(schema.pagespeedResults.fetchedAt)).limit(1);
  return row ?? null;
}

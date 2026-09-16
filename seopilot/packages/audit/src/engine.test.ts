import { describe, expect, it } from "vitest";
import { ALL_RULES, ruleCatalog } from "./rules";
import { buildContext, runAudit } from "./engine";
import { CATEGORY_WEIGHTS, SEVERITY_IMPACT, rulePenalty, scoreCategories } from "./scoring";
import type { AuditInput, AuditPage, RuleDefinition } from "./types";

function page(over: Partial<AuditPage> & { url: string }): AuditPage {
  const url = over.url;
  return {
    normalizedUrl: url,
    depth: 1,
    discoverySource: "link",
    statusCode: 200,
    fetchClass: "ok",
    isHtml: true,
    redirectUrl: null,
    redirectChain: [],
    responseTimeMs: 300,
    ttfbMs: 120,
    byteLength: 20_000,
    contentEncoding: "gzip",
    isHttps: true,
    title: "A perfectly reasonable page title for testing",
    metaDescription: "A meta description that is long enough to pass the minimum length check for the audit engine tests.",
    canonicalUrl: url,
    headerCanonicalUrl: null,
    robotsMeta: null,
    xRobotsTag: null,
    responseHeaders: { "cache-control": "max-age=0", "strict-transport-security": "max-age=1", "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN" },
    isIndexable: true,
    isNofollow: false,
    h1s: ["Heading"],
    headingOutline: [{ level: 1, text: "Heading" }, { level: 2, text: "Sub" }],
    wordCount: 600,
    contentHash: `hash-${url}`,
    lang: "en",
    hreflang: [],
    ogTitle: "og",
    ogDescription: "og d",
    ogImage: "https://example.com/og.png",
    imageCount: 1,
    imagesMissingAlt: 0,
    images: [{ src: "https://example.com/a.png", alt: "a" }],
    internalLinkCount: 1,
    externalLinkCount: 0,
    structuredData: [{ format: "json-ld", type: "Organization", valid: true, errors: [], warnings: [] }],
    mixedContent: [],
    viewportMeta: true,
    renderedWithJs: false,
    inSitemap: true,
    links: [],
    ...over,
  };
}

const HOME = "https://example.com/";
function input(pages: AuditPage[], over: Partial<AuditInput["site"]> = {}, ext = new Map<string, number | null>()): AuditInput {
  return {
    site: { startUrl: HOME, finalStartUrl: HOME, robotsTxtFound: true, robotsTxt: "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml", sitemapUrls: ["https://example.com/sitemap.xml"], sitemapEntries: pages.filter((p) => p.inSitemap).map((p) => ({ url: p.url, normalizedUrl: p.normalizedUrl, lastmod: null })), stopReason: "frontier_exhausted", ...over },
    pages,
    externalLinkStatus: ext,
  };
}

const perfectSite = () => {
  const about = page({ url: "https://example.com/about", title: "About our company and the team behind it", metaDescription: "Everything about the company, the people behind it and why we do what we do every single day.", links: [{ targetNormalizedUrl: HOME, anchor: "Home", isInternal: true, isNofollow: false }] });
  const home = page({ url: HOME, depth: 0, discoverySource: "start", title: "Example Company – home of good examples", metaDescription: "Home page description, long enough to be considered a valid description by the engine rules.", links: [{ targetNormalizedUrl: about.normalizedUrl, anchor: "About us", isInternal: true, isNofollow: false }] });
  return [home, about];
};

describe("rule catalogue", () => {
  it("has unique dotted ids, valid weights and docs", () => {
    const ids = new Set(ALL_RULES.map((r) => r.id));
    expect(ids.size).toBe(ALL_RULES.length);
    expect(ALL_RULES.length).toBeGreaterThanOrEqual(60);
    for (const r of ALL_RULES) {
      expect(r.id).toMatch(/^[a-z_]+(\.[a-z0-9_]+)+$/);
      expect(r.id.startsWith(`${r.category}.`)).toBe(true);
      expect(r.weight).toBeGreaterThanOrEqual(1);
      expect(r.weight).toBeLessThanOrEqual(3);
      expect(r.recommendation.length).toBeGreaterThan(20);
      expect(r.description.length).toBeGreaterThan(20);
    }
    expect(ruleCatalog()[0]).toHaveProperty("recommendation");
  });
});

describe("scoring", () => {
  it("penalty = impact × weight × ratio, clamped", () => {
    expect(rulePenalty("high", 2, 0.5)).toBe(SEVERITY_IMPACT.high * 2 * 0.5);
    expect(rulePenalty("critical", 3, 2)).toBe(SEVERITY_IMPACT.critical * 3);
    expect(rulePenalty("notice", 3, 1)).toBe(0);
  });
  it("category weights sum to 100 and scores are weighted averages with explanations", () => {
    expect(Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    const { overall, breakdown } = scoreCategories([
      { ruleId: "metadata.title.missing", category: "metadata", severity: "high", weight: 3, findings: 5, applicable: 10, affectedRatio: 0.5, penalty: 27, durationMs: 0, error: null },
    ]);
    expect(breakdown["metadata"]?.score).toBe(73);
    expect(breakdown["metadata"]?.explanation).toContain("metadata.title.missing (−27, 5 findings)");
    expect(breakdown["indexability"]?.score).toBe(100);
    expect(overall).toBe(Math.round((100 * 85 + 73 * 15) / 100));
  });
});

describe("runAudit", () => {
  it("scores a clean site 100 with zero non-notice findings", () => {
    const r = runAudit(input(perfectSite()));
    const nonNotice = r.findings.filter((f) => f.severity !== "notice");
    expect(nonNotice.map((f) => f.ruleId)).toEqual([]);
    expect(r.scoreOverall).toBe(100);
    expect(r.rules.every((x) => x.error === null)).toBe(true);
    expect(r.scoringVersion).toMatch(/^\d{4}\.\d{2}/);
  });

  it("detects a broad set of issues with evidence and deterministic dedupe keys", () => {
    const [home, about] = perfectSite() as [AuditPage, AuditPage];
    const dup1 = page({ url: "https://example.com/dup-1", title: "Same title", metaDescription: null, contentHash: "same", h1s: [], wordCount: 120, imageCount: 2, imagesMissingAlt: 2, images: [{ src: "x", alt: null }], viewportMeta: false, lang: null, links: [{ targetNormalizedUrl: "https://example.com/missing", anchor: "click here", isInternal: true, isNofollow: false }, { targetNormalizedUrl: "https://external.test/gone", anchor: "ext", isInternal: false, isNofollow: false }] });
    const dup2 = page({ url: "https://example.com/dup-2", title: "Same title", contentHash: "same", h1s: ["a", "b"], headingOutline: [{ level: 1, text: "a" }, { level: 3, text: "c" }], inSitemap: false });
    const canonToRedirect = page({ url: "https://example.com/canon-bad", canonicalUrl: "https://example.com/redir", inSitemap: false });
    const missing = page({ url: "https://example.com/missing", statusCode: 404, fetchClass: "client_error", isIndexable: true, inSitemap: true });
    const redir = page({ url: "https://example.com/redir", statusCode: 301, fetchClass: "redirect", isHtml: false, redirectUrl: "https://example.com/redir2", inSitemap: false });
    const redir2 = page({ url: "https://example.com/redir2", statusCode: 302, fetchClass: "redirect", isHtml: false, redirectUrl: HOME, inSitemap: false });
    const noindexInSitemap = page({ url: "https://example.com/hidden", isIndexable: false, robotsMeta: "noindex", inSitemap: true });
    const httpPage = page({ url: "http://example.com/insecure", isHttps: false, mixedContent: [], responseHeaders: {}, contentEncoding: null, byteLength: 400_000, ttfbMs: 1500, responseTimeMs: 4000, inSitemap: false });
    const orphan = page({ url: "https://example.com/orphan", discoverySource: "sitemap", structuredData: [{ format: "json-ld", type: "Product", valid: false, errors: ['missing required property "name"'], warnings: [] }], hreflang: [{ lang: "en-UK", href: "https://example.com/orphan" }, { lang: "fr", href: "https://example.com/fr" }] });
    home.links.push(...[dup1, dup2, canonToRedirect, missing, redir, noindexInSitemap, httpPage].map((p) => ({ targetNormalizedUrl: p.normalizedUrl, anchor: "x", isInternal: true, isNofollow: false })));
    home.links.push({ targetNormalizedUrl: about.normalizedUrl, anchor: "About", isInternal: true, isNofollow: true });

    const r = runAudit(input([home, about, dup1, dup2, canonToRedirect, missing, redir, redir2, noindexInSitemap, httpPage, orphan], {}, new Map([["https://external.test/gone", 410]])));
    const byRule = new Map<string, typeof r.findings>();
    for (const f of r.findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
    const has = (id: string, url?: string) => expect(byRule.get(id)?.some((f) => !url || f.pageUrl === url), `${id} ${url ?? ""}`).toBe(true);

    has("indexability.http.client_error", missing.url);
    has("indexability.sitemap.non_200_urls", missing.url);
    has("indexability.robots.noindex_in_sitemap", noindexInSitemap.url);
    has("indexability.redirect.chain", redir.url);
    has("indexability.redirect.temporary", redir2.url);
    has("indexability.canonical.target_broken", canonToRedirect.url);
    has("indexability.canonical.points_elsewhere", canonToRedirect.url);
    has("indexability.sitemap.indexable_not_in_sitemap", httpPage.url);
    has("metadata.title.duplicate", dup1.url);
    has("metadata.title.duplicate", dup2.url);
    has("metadata.title.too_short", dup1.url);
    has("metadata.description.missing", dup1.url);
    has("metadata.lang.missing", dup1.url);
    has("content.duplicate", dup1.url);
    has("content.thin", dup1.url);
    has("content.h1.missing", dup1.url);
    has("content.h1.multiple", dup2.url);
    has("content.headings.skipped_level", dup2.url);
    has("links.internal.broken", dup1.url);
    has("links.external.broken", dup1.url);
    has("links.internal.to_redirect", home.url);
    has("links.page.orphan", orphan.url);
    has("images.alt.missing", dup1.url);
    has("mobile.viewport.missing", dup1.url);
    has("security.https.not_used", httpPage.url);
    has("security.headers.content_type_options_missing", httpPage.url);
    expect(byRule.get("security.headers.hsts_missing")?.some((f) => f.pageUrl === httpPage.url)).toBeFalsy(); // HSTS only meaningful over HTTPS
    has("performance.ttfb.slow", httpPage.url);
    has("performance.compression.missing", httpPage.url);
    has("performance.html.large", httpPage.url);
    has("structured_data.invalid", orphan.url);
    has("international.hreflang.invalid_code", orphan.url);
    has("international.hreflang.missing_x_default", orphan.url);
    const brokenFromDup1 = byRule.get("links.internal.broken")?.find((f) => f.pageUrl === dup1.url);
    expect(brokenFromDup1?.dedupeKey).toBe(`${dup1.url}→https://example.com/missing`);
    expect(brokenFromDup1?.evidence).toMatchObject({ targetStatus: 404 });
    // no false positives on the clean pages
    expect(r.findings.filter((f) => f.pageUrl === about.url && f.severity !== "notice").map((f) => f.ruleId)).toEqual([]);
    // score is reduced and transparently explained
    expect(r.scoreOverall).toBeLessThan(90);
    // Reproduce the overall score by hand from the published breakdown.
    const manual = Math.round(Object.values(r.scoreBreakdown).reduce((a, c) => a + c.score * c.weight, 0) / 100);
    expect(r.scoreOverall).toBe(manual);
    // And a category from its rule penalties.
    const idxPenalty = r.rules.filter((x) => x.category === "indexability").reduce((a, x) => a + x.penalty, 0);
    expect(r.scoreBreakdown["indexability"]?.score).toBe(Math.max(0, Math.round(100 - idxPenalty)));
    expect(r.scoreBreakdown["indexability"]?.explanation).toMatch(/Largest deductions/);
    expect(r.issueCounts.high).toBeGreaterThan(0);
    expect(r.pagesEvaluated).toBe(11);
    const dedupeKeys = new Set(r.findings.map((f) => `${f.ruleId}|${f.dedupeKey}`));
    expect(dedupeKeys.size).toBe(r.findings.length);
  });

  it("never guesses about uncrawled targets and treats robots-blocked as unknown", () => {
    const [home] = perfectSite() as [AuditPage, AuditPage];
    home.links = [{ targetNormalizedUrl: "https://example.com/unknown", anchor: "u", isInternal: true, isNofollow: false }, { targetNormalizedUrl: "https://example.com/blocked", anchor: "b", isInternal: true, isNofollow: false }];
    const blocked = page({ url: "https://example.com/blocked", statusCode: null, fetchClass: "skipped_robots", isHtml: false, inSitemap: false });
    const ctx = buildContext(input([home, blocked]));
    expect(ctx.statusOf("https://example.com/unknown")).toBeUndefined();
    expect(ctx.statusOf("https://example.com/blocked")).toBeUndefined();
    const r = runAudit(input([home, blocked]));
    expect(r.findings.filter((f) => f.ruleId === "links.internal.broken")).toEqual([]);
    expect(r.findings.some((f) => f.ruleId === "indexability.robots.blocked_by_robots_txt")).toBe(true);
  });

  it("site rules: robots blocks all, no sitemap, homepage not indexable", () => {
    const home = page({ url: HOME, depth: 0, discoverySource: "start", statusCode: 503, fetchClass: "server_error", inSitemap: false });
    const r = runAudit(input([home], { robotsTxt: "User-agent: *\nDisallow: /", sitemapUrls: [], sitemapEntries: [] }));
    const ids = r.findings.map((f) => f.ruleId);
    expect(ids).toContain("indexability.robots_txt.blocks_all");
    expect(ids).toContain("indexability.sitemap.missing");
    expect(ids).toContain("indexability.homepage.not_indexable");
    expect(ids).toContain("indexability.http.server_error");
    expect(r.scoreBreakdown["indexability"]?.score).toBe(0);
  });

  it("isolates rule exceptions and reports them instead of failing", () => {
    const boom: RuleDefinition = { id: "content.boom", category: "content", severity: "high", weight: 1, scope: "page", title: "t", description: "d", recommendation: "r", documentationUrl: null, checkPage: () => { throw new Error("kaboom"); } };
    const r = runAudit(input(perfectSite()), { rules: [boom, ...ALL_RULES] });
    const res = r.rules.find((x) => x.ruleId === "content.boom");
    expect(res?.error).toBe("Error: kaboom");
    expect(res?.penalty).toBe(0);
    expect(r.scoreOverall).toBe(100);
  });

  it("respects enabledRuleIds and per-rule finding cap", () => {
    const pages = Array.from({ length: 30 }, (_, i) => page({ url: `https://example.com/p${i}`, title: null }));
    const r = runAudit(input([...perfectSite(), ...pages]), { enabledRuleIds: ["metadata.title.missing"], maxFindingsPerRule: 10 });
    expect(r.rules).toHaveLength(1);
    expect(r.findings).toHaveLength(10);
    expect(r.rules[0]?.applicable).toBe(32);
  });
});

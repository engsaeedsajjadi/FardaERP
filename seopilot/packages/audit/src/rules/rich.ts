import { DOCS, defineRule, isOk } from "./_helpers";
import type { AuditContext, RuleDefinition } from "../types";

const HREFLANG_RE = /^(x-default|[a-z]{2,3}(-[a-z]{2}|-\d{3})?(-[a-z]{4})?)$/i;

export const structuredDataRules: RuleDefinition[] = [
  defineRule({
    id: "structured_data.invalid",
    category: "structured_data", severity: "medium", weight: 2, scope: "page",
    title: "Structured data has errors",
    description: "JSON-LD that fails to parse or lacks properties Google requires makes the page ineligible for rich results.",
    recommendation: "Fix the listed errors and re-validate with Google's Rich Results Test.",
    documentationUrl: DOCS.google("appearance/structured-data/intro-structured-data"),
    appliesTo: (p) => isOk(p) && p.structuredData.length > 0,
    checkPage: (p) => {
      const invalid = p.structuredData.filter((s) => !s.valid);
      return invalid.length ? { pageUrl: p.url, evidence: { items: invalid.slice(0, 10).map((s) => ({ type: s.type, format: s.format, errors: s.errors.slice(0, 5) })) } } : null;
    },
  }),
  defineRule({
    id: "structured_data.missing_recommended",
    category: "structured_data", severity: "notice", weight: 1, scope: "page",
    title: "Structured data missing recommended properties",
    description: "Recommended properties are not required, but adding them increases the chance and richness of enhanced results.",
    recommendation: "Add the listed recommended properties where the data exists.",
    documentationUrl: DOCS.google("appearance/structured-data/search-gallery"),
    appliesTo: (p) => isOk(p) && p.structuredData.length > 0,
    checkPage: (p) => {
      const w = p.structuredData.filter((s) => s.valid && s.warnings.length);
      return w.length ? { pageUrl: p.url, evidence: { items: w.slice(0, 10).map((s) => ({ type: s.type, warnings: s.warnings.slice(0, 5) })) } } : null;
    },
  }),
  defineRule({
    id: "structured_data.none_on_site",
    category: "structured_data", severity: "low", weight: 1, scope: "site",
    title: "No structured data found anywhere on the site",
    description: "Not a single crawled page declares schema.org markup. Structured data enables rich results and helps AI/answer engines understand entities.",
    recommendation: "Start with Organization/WebSite on the homepage, BreadcrumbList site-wide and content-specific types (Article, Product, FAQPage…) where applicable.",
    documentationUrl: DOCS.google("appearance/structured-data/intro-structured-data"),
    checkSite: (ctx) => (ctx.htmlPages.length > 0 && ctx.htmlPages.every((p) => p.structuredData.length === 0) ? { pageUrl: null, evidence: { pagesChecked: ctx.htmlPages.length } } : null),
  }),
  defineRule({
    id: "structured_data.homepage_missing_organization",
    category: "structured_data", severity: "notice", weight: 1, scope: "site",
    title: "Homepage lacks Organization / WebSite schema",
    description: "Organization (or LocalBusiness/Person) and WebSite markup on the homepage establish the site entity for knowledge panels and AI answers.",
    recommendation: "Add JSON-LD Organization (name, url, logo, sameAs) and WebSite to the homepage.",
    documentationUrl: DOCS.google("appearance/structured-data/organization"),
    checkSite: (ctx) => {
      const h = ctx.homepage;
      if (!h || h.statusCode !== 200) return null;
      const types = new Set(h.structuredData.map((s) => s.type));
      const has = [...types].some((t) => /Organization|LocalBusiness|Person|WebSite|Corporation|Store|Restaurant/i.test(t));
      return has ? null : { pageUrl: h.url, evidence: { typesFound: [...types] } };
    },
  }),
];

export const imageRules: RuleDefinition[] = [
  defineRule({
    id: "images.alt.missing",
    category: "images", severity: "medium", weight: 2, scope: "page",
    title: "Images missing alt text",
    description: "Alt text is required for accessibility and is the main signal for image search. Decorative images should use an empty alt (alt=\"\").",
    recommendation: "Add descriptive alt text to content images; use alt=\"\" for purely decorative ones.",
    documentationUrl: DOCS.google("appearance/google-images"),
    appliesTo: (p) => isOk(p) && p.isIndexable && p.imageCount > 0,
    checkPage: (p) => (p.imagesMissingAlt > 0 ? { pageUrl: p.url, evidence: { missing: p.imagesMissingAlt, total: p.imageCount, examples: p.images.filter((i) => i.alt === null).slice(0, 5).map((i) => i.src) } } : null),
  }),
  defineRule({
    id: "images.og_image.missing",
    category: "images", severity: "notice", weight: 1, scope: "page",
    title: "No og:image",
    description: "Shared links without an image get far less engagement on social and messaging platforms.",
    recommendation: "Provide a 1200×630 og:image (absolute URL) on every page intended to be shared.",
    documentationUrl: "https://ogp.me/#structured",
    checkPage: (p) => (!p.ogImage ? { pageUrl: p.url, evidence: {} } : null),
  }),
];

const hreflangIndex = new WeakMap<object, Map<string, Array<{ lang: string; href: string }>>>();
function hreflangOf(ctx: AuditContext, url: string) {
  let m = hreflangIndex.get(ctx);
  if (!m) {
    m = new Map();
    for (const p of ctx.htmlPages) if (p.hreflang.length) m.set(p.normalizedUrl, p.hreflang);
    hreflangIndex.set(ctx, m);
  }
  return m.get(url);
}

export const internationalRules: RuleDefinition[] = [
  defineRule({
    id: "international.hreflang.invalid_code",
    category: "international", severity: "medium", weight: 2, scope: "page",
    title: "Invalid hreflang language/region code",
    description: "hreflang values must be ISO 639-1 language codes optionally followed by an ISO 3166-1 Alpha-2 region (e.g. en, en-GB, x-default). Invalid values are ignored.",
    recommendation: "Correct the codes (common mistakes: en-UK → en-GB, using country only, underscores instead of hyphens).",
    documentationUrl: DOCS.google("specialty/international/localized-versions"),
    appliesTo: (p) => isOk(p) && p.hreflang.length > 0,
    checkPage: (p) => {
      const bad = p.hreflang.filter((h) => !HREFLANG_RE.test(h.lang) || /-uk$/i.test(h.lang));
      return bad.length ? { pageUrl: p.url, evidence: { invalid: bad.slice(0, 10) } } : null;
    },
  }),
  defineRule({
    id: "international.hreflang.missing_self",
    category: "international", severity: "low", weight: 1, scope: "page",
    title: "hreflang set does not include the page itself",
    description: "Each page in an hreflang cluster must list itself; otherwise the annotations are ignored.",
    recommendation: "Add a self-referencing hreflang entry with the page's own language.",
    documentationUrl: DOCS.google("specialty/international/localized-versions"),
    appliesTo: (p) => isOk(p) && p.hreflang.length > 0,
    checkPage: (p) => (p.hreflang.some((h) => h.href === p.normalizedUrl || h.href === p.url) ? null : { pageUrl: p.url, evidence: { hrefs: p.hreflang.slice(0, 10).map((h) => h.href) } }),
  }),
  defineRule({
    id: "international.hreflang.no_return_link",
    category: "international", severity: "medium", weight: 2, scope: "page",
    title: "hreflang target does not link back",
    description: "hreflang must be reciprocal: if A lists B, B must list A. One-directional annotations are discarded.",
    recommendation: "Add the missing return annotations on the target pages (or generate hreflang from a single source of truth / sitemap).",
    documentationUrl: DOCS.google("specialty/international/localized-versions"),
    appliesTo: (p) => isOk(p) && p.hreflang.length > 0,
    checkPage: (p, ctx) => {
      const missing: string[] = [];
      for (const h of p.hreflang) {
        if (h.href === p.normalizedUrl) continue;
        const target = ctx.byUrl.get(h.href);
        if (!target || !isOk(target)) continue; // not crawled → unknown, do not guess
        const back = hreflangOf(ctx, h.href);
        if (!back || !back.some((b) => b.href === p.normalizedUrl || b.href === p.url)) missing.push(h.href);
      }
      return missing.length ? { pageUrl: p.url, evidence: { missingReturnFrom: missing.slice(0, 10) } } : null;
    },
  }),
  defineRule({
    id: "international.hreflang.missing_x_default",
    category: "international", severity: "notice", weight: 1, scope: "page",
    title: "hreflang cluster has no x-default",
    description: "x-default tells search engines which version to show users whose language does not match any listed variant.",
    recommendation: "Add `<link rel=\"alternate\" hreflang=\"x-default\" href=\"…\">` pointing to the language selector or default version.",
    documentationUrl: DOCS.google("specialty/international/localized-versions"),
    appliesTo: (p) => isOk(p) && p.hreflang.length > 1,
    checkPage: (p) => (p.hreflang.some((h) => h.lang.toLowerCase() === "x-default") ? null : { pageUrl: p.url, evidence: {} }),
  }),
  defineRule({
    id: "international.hreflang.target_not_indexable",
    category: "international", severity: "medium", weight: 1, scope: "page",
    title: "hreflang points to a non-200 or noindex page",
    description: "Alternate URLs must be live, indexable pages; pointing at redirects or errors invalidates the cluster.",
    recommendation: "Update hreflang targets to the final canonical, indexable URLs.",
    documentationUrl: DOCS.google("specialty/international/localized-versions"),
    appliesTo: (p) => isOk(p) && p.hreflang.length > 0,
    checkPage: (p, ctx) => {
      const bad = p.hreflang.map((h) => ({ h, t: ctx.byUrl.get(h.href) })).filter((x) => x.t && (x.t.statusCode !== 200 || !x.t.isIndexable));
      return bad.length ? { pageUrl: p.url, evidence: { targets: bad.slice(0, 10).map((x) => ({ href: x.h.href, status: x.t?.statusCode, indexable: x.t?.isIndexable })) } } : null;
    },
  }),
];

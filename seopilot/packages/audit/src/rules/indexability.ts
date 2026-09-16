import { DOCS, defineRule, every, fetched, isOk, pathOf, trunc } from "./_helpers";
import type { RuleDefinition } from "../types";

export const indexabilityRules: RuleDefinition[] = [
  defineRule({
    id: "indexability.http.client_error",
    category: "indexability", severity: "high", weight: 3, scope: "page",
    title: "Page returns a 4xx client error",
    description: "Internally linked URLs that return 4xx (404, 410, 403…) waste crawl budget and break the user journey. Linked 404s also leak link equity.",
    recommendation: "Fix or remove internal links pointing here. If the page moved, 301-redirect it to the closest equivalent; if it is intentionally gone, return 410 and drop the links.",
    documentationUrl: DOCS.google("crawling-indexing/http-network-errors"),
    appliesTo: fetched,
    checkPage: (p, ctx) => (p.statusCode !== null && p.statusCode >= 400 && p.statusCode < 500 && p.fetchClass !== "blocked" ? { pageUrl: p.url, evidence: { statusCode: p.statusCode, inboundLinks: ctx.inbound.get(p.normalizedUrl) ?? 0, discoveredFrom: p.discoverySource } } : null),
  }),
  defineRule({
    id: "indexability.http.server_error",
    category: "indexability", severity: "critical", weight: 3, scope: "page",
    title: "Page returns a 5xx server error",
    description: "Server errors prevent crawling and indexing entirely. Repeated 5xx responses cause Google to reduce crawl rate and eventually drop the URL.",
    recommendation: "Inspect server logs for this URL, fix the underlying failure (timeouts, exceptions, upstream outages) and re-crawl to confirm a 200.",
    documentationUrl: DOCS.google("crawling-indexing/http-network-errors"),
    appliesTo: fetched,
    checkPage: (p) => (p.statusCode !== null && p.statusCode >= 500 ? { pageUrl: p.url, evidence: { statusCode: p.statusCode } } : null),
  }),
  defineRule({
    id: "indexability.http.unreachable",
    category: "indexability", severity: "high", weight: 2, scope: "page",
    title: "Page could not be fetched (timeout / network error)",
    description: "The crawler could not obtain a response within the time budget. Search engine crawlers apply similar limits and will treat the URL as unavailable.",
    recommendation: "Check server capacity, DNS and TLS configuration for this URL. If it is consistently slow, look at server-side rendering time and upstream dependencies.",
    documentationUrl: DOCS.google("crawling-indexing/http-network-errors"),
    appliesTo: every,
    checkPage: (p) => (p.fetchClass === "timeout" || p.fetchClass === "network_error" || p.fetchClass === "too_large" ? { pageUrl: p.url, evidence: { fetchClass: p.fetchClass, error: p.responseHeaders["error"] ?? null } } : null),
  }),
  defineRule({
    id: "indexability.http.blocked",
    category: "indexability", severity: "medium", weight: 1, scope: "page",
    title: "Crawler blocked (403 / bot challenge)",
    description: "The server refused the request or served a bot-protection challenge. If Googlebot is treated the same way the page will not be indexed.",
    recommendation: "Verify that your WAF/CDN allows verified search engine crawlers and the SEOPilot user agent. Test with the URL Inspection tool in Search Console.",
    documentationUrl: DOCS.google("crawling-indexing/verifying-googlebot"),
    appliesTo: fetched,
    checkPage: (p) => (p.fetchClass === "blocked" ? { pageUrl: p.url, evidence: { statusCode: p.statusCode } } : null),
  }),
  defineRule({
    id: "indexability.robots.noindex_in_sitemap",
    category: "indexability", severity: "high", weight: 2, scope: "page",
    title: "Noindex page listed in XML sitemap",
    description: "Sitemaps should only contain canonical, indexable URLs. Listing noindex pages sends contradictory signals and wastes crawl budget.",
    recommendation: "Either remove the URL from the sitemap or remove the noindex directive, depending on whether the page should rank.",
    documentationUrl: DOCS.google("crawling-indexing/sitemaps/build-sitemap"),
    appliesTo: isOk,
    checkPage: (p) => (!p.isIndexable && p.inSitemap ? { pageUrl: p.url, evidence: { robotsMeta: p.robotsMeta, xRobotsTag: p.xRobotsTag } } : null),
  }),
  defineRule({
    id: "indexability.robots.noindex",
    category: "indexability", severity: "notice", weight: 1, scope: "page",
    title: "Page is noindex",
    description: "Informational: this page asks search engines not to index it. Review the list to make sure no revenue-generating pages are excluded by mistake.",
    recommendation: "Confirm each noindexed page is intentional (thank-you pages, internal search, filters). Remove the directive from pages that should rank.",
    documentationUrl: DOCS.google("crawling-indexing/block-indexing"),
    appliesTo: isOk,
    checkPage: (p) => (!p.isIndexable ? { pageUrl: p.url, evidence: { robotsMeta: p.robotsMeta, xRobotsTag: p.xRobotsTag, source: p.xRobotsTag && /noindex|none/i.test(p.xRobotsTag) ? "x-robots-tag" : "meta" } } : null),
  }),
  defineRule({
    id: "indexability.robots.blocked_by_robots_txt",
    category: "indexability", severity: "notice", weight: 1, scope: "page",
    title: "URL disallowed by robots.txt",
    description: "Informational: internally linked URLs that robots.txt disallows. Blocked URLs can still be indexed (without content) if linked, and cannot pass a noindex.",
    recommendation: "Make sure disallowed paths are not meant to rank. To keep a page out of the index, use noindex instead of robots.txt.",
    documentationUrl: DOCS.google("crawling-indexing/robots/intro"),
    appliesTo: every,
    checkPage: (p, ctx) => (p.fetchClass === "skipped_robots" ? { pageUrl: p.url, evidence: { inboundLinks: ctx.inbound.get(p.normalizedUrl) ?? 0 } } : null),
  }),
  defineRule({
    id: "indexability.canonical.missing",
    category: "indexability", severity: "low", weight: 1, scope: "page",
    title: "Missing canonical tag",
    description: "Without a canonical, search engines choose the canonical themselves, which can split signals between URL variants (parameters, trailing slashes, http/https).",
    recommendation: "Add a self-referencing <link rel=\"canonical\"> with the absolute preferred URL on every indexable page.",
    documentationUrl: DOCS.google("crawling-indexing/consolidate-duplicate-urls"),
    checkPage: (p) => (!p.canonicalUrl && !p.headerCanonicalUrl ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "indexability.canonical.points_elsewhere",
    category: "indexability", severity: "notice", weight: 1, scope: "page",
    title: "Canonical points to a different URL",
    description: "Informational: the page declares another URL as canonical, so it will not be indexed itself. Check that this is intended and that the target is indexable.",
    recommendation: "For unique content, use a self-referencing canonical. Verify the canonical target returns 200, is indexable and is not itself canonicalised elsewhere.",
    documentationUrl: DOCS.google("crawling-indexing/consolidate-duplicate-urls"),
    appliesTo: isOk,
    checkPage: (p) => (p.canonicalUrl && p.canonicalUrl !== p.normalizedUrl ? { pageUrl: p.url, evidence: { canonicalUrl: p.canonicalUrl } } : null),
  }),
  defineRule({
    id: "indexability.canonical.target_broken",
    category: "indexability", severity: "high", weight: 3, scope: "page",
    title: "Canonical target is not a 200 indexable page",
    description: "A canonical that points to a redirect, error or noindex page is ignored by search engines and creates an indexing dead end.",
    recommendation: "Point the canonical at the final 200, indexable URL (follow any redirect chain to its end).",
    documentationUrl: DOCS.google("crawling-indexing/consolidate-duplicate-urls"),
    appliesTo: isOk,
    checkPage: (p, ctx) => {
      if (!p.canonicalUrl || p.canonicalUrl === p.normalizedUrl) return null;
      const target = ctx.byUrl.get(p.canonicalUrl);
      if (!target) return null; // unknown; never guess
      const bad = target.statusCode !== 200 || !target.isIndexable;
      return bad ? { pageUrl: p.url, evidence: { canonicalUrl: p.canonicalUrl, targetStatus: target.statusCode, targetIndexable: target.isIndexable } } : null;
    },
  }),
  defineRule({
    id: "indexability.canonical.conflict",
    category: "indexability", severity: "medium", weight: 2, scope: "page",
    title: "Conflicting canonical signals (HTML vs HTTP header)",
    description: "The page sends a canonical both in HTML and in a Link HTTP header and they disagree; search engines may pick either.",
    recommendation: "Use only one canonical declaration per page, or make sure both refer to the same absolute URL.",
    documentationUrl: DOCS.google("crawling-indexing/consolidate-duplicate-urls"),
    appliesTo: isOk,
    checkPage: (p) => (p.canonicalUrl && p.headerCanonicalUrl && p.canonicalUrl !== p.headerCanonicalUrl ? { pageUrl: p.url, evidence: { htmlCanonical: p.canonicalUrl, headerCanonical: p.headerCanonicalUrl } } : null),
  }),
  defineRule({
    id: "indexability.redirect.chain",
    category: "indexability", severity: "medium", weight: 2, scope: "page",
    title: "Redirect chain",
    description: "Multiple consecutive redirects slow users down and each hop loses a little crawl budget; Googlebot follows at most 10 hops.",
    recommendation: "Update the internal links to point at the final URL and collapse the chain to a single 301.",
    documentationUrl: DOCS.google("crawling-indexing/301-redirects"),
    appliesTo: every,
    checkPage: (p, ctx) => {
      if (!p.redirectUrl) return null;
      // Follow through our own crawl data.
      const hops: string[] = [p.normalizedUrl];
      let cur = p.redirectUrl;
      const seen = new Set(hops);
      while (cur && !seen.has(cur) && hops.length < 12) {
        hops.push(cur);
        seen.add(cur);
        const next = ctx.byUrl.get(cur);
        if (!next?.redirectUrl) break;
        cur = next.redirectUrl;
      }
      return hops.length > 2 ? { pageUrl: p.url, evidence: { hops, hopCount: hops.length - 1 } } : null;
    },
  }),
  defineRule({
    id: "indexability.redirect.loop",
    category: "indexability", severity: "critical", weight: 2, scope: "page",
    title: "Redirect loop",
    description: "The URL redirects back to itself (directly or via other URLs). Browsers and crawlers give up, so the content is unreachable.",
    recommendation: "Fix the redirect rules so the chain terminates at a 200 page.",
    documentationUrl: DOCS.google("crawling-indexing/301-redirects"),
    appliesTo: every,
    checkPage: (p, ctx) => {
      if (!p.redirectUrl) return null;
      const seen = new Set([p.normalizedUrl]);
      let cur: string | null = p.redirectUrl;
      let steps = 0;
      while (cur && steps++ < 12) {
        if (seen.has(cur)) return { pageUrl: p.url, evidence: { loopAt: cur, hops: [...seen] } };
        seen.add(cur);
        cur = ctx.byUrl.get(cur)?.redirectUrl ?? null;
      }
      return null;
    },
  }),
  defineRule({
    id: "indexability.redirect.temporary",
    category: "indexability", severity: "low", weight: 1, scope: "page",
    title: "Temporary redirect (302/307) used for a permanent move",
    description: "302/307 tells search engines the original URL may return, so signals are consolidated more slowly than with a 301/308.",
    recommendation: "If the move is permanent, use a 301 (or 308 to preserve method).",
    documentationUrl: DOCS.google("crawling-indexing/301-redirects"),
    appliesTo: fetched,
    checkPage: (p, ctx) => (p.statusCode === 302 || p.statusCode === 307 ? { pageUrl: p.url, evidence: { statusCode: p.statusCode, redirectUrl: p.redirectUrl, inboundLinks: ctx.inbound.get(p.normalizedUrl) ?? 0, discoverySource: p.discoverySource } } : null),
  }),
  defineRule({
    id: "indexability.redirect.meta_refresh",
    category: "indexability", severity: "low", weight: 1, scope: "page",
    title: "Redirect target is a 4xx/5xx",
    description: "Redirects that end on an error page send users and crawlers to a dead end.",
    recommendation: "Repoint the redirect to a live 200 page or remove it.",
    documentationUrl: DOCS.google("crawling-indexing/301-redirects"),
    appliesTo: every,
    checkPage: (p, ctx) => {
      if (!p.redirectUrl) return null;
      const t = ctx.statusOf(p.redirectUrl);
      return typeof t === "number" && t >= 400 ? { pageUrl: p.url, evidence: { redirectUrl: p.redirectUrl, targetStatus: t } } : null;
    },
  }),
  defineRule({
    id: "indexability.sitemap.missing",
    category: "indexability", severity: "medium", weight: 2, scope: "site",
    title: "No XML sitemap found",
    description: "No sitemap was declared in robots.txt or found at /sitemap.xml. Sitemaps help search engines discover deep and recently changed pages.",
    recommendation: "Generate an XML sitemap containing canonical indexable URLs with accurate <lastmod>, reference it in robots.txt and submit it in Search Console.",
    documentationUrl: DOCS.google("crawling-indexing/sitemaps/overview"),
    checkSite: (ctx) => (ctx.site.sitemapUrls.length === 0 ? { pageUrl: null, evidence: { robotsTxtFound: ctx.site.robotsTxtFound } } : null),
  }),
  defineRule({
    id: "indexability.sitemap.non_200_urls",
    category: "indexability", severity: "medium", weight: 2, scope: "page",
    title: "Sitemap lists a URL that is not a 200",
    description: "Sitemap URLs that redirect or error erode trust in the sitemap and waste crawl budget.",
    recommendation: "Regenerate the sitemap from the live canonical URL set and drop redirected/removed entries.",
    documentationUrl: DOCS.google("crawling-indexing/sitemaps/build-sitemap"),
    appliesTo: (p) => p.inSitemap && p.statusCode !== null,
    checkPage: (p) => (p.statusCode !== 200 ? { pageUrl: p.url, evidence: { statusCode: p.statusCode, redirectUrl: p.redirectUrl } } : null),
  }),
  defineRule({
    id: "indexability.sitemap.orphan_only_in_sitemap",
    category: "indexability", severity: "low", weight: 1, scope: "page",
    title: "Orphan page (only reachable via sitemap)",
    description: "The page has no internal links pointing to it. Pages without internal links receive little PageRank and are seen as unimportant.",
    recommendation: "Link to the page from relevant navigation, hub or related-content sections, or remove it from the sitemap if it should not rank.",
    documentationUrl: DOCS.google("fundamentals/seo-starter-guide"),
    checkPage: (p, ctx) => (p.discoverySource === "sitemap" && (ctx.inbound.get(p.normalizedUrl) ?? 0) === 0 && p.depth > 0 ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "indexability.sitemap.indexable_not_in_sitemap",
    category: "indexability", severity: "notice", weight: 1, scope: "page",
    title: "Indexable page missing from XML sitemap",
    description: "Informational: indexable pages not listed in any sitemap. Not an error, but sitemap coverage helps discovery and lets Search Console report on the page.",
    recommendation: "Include all canonical indexable URLs in the sitemap.",
    documentationUrl: DOCS.google("crawling-indexing/sitemaps/build-sitemap"),
    appliesTo: (p, ctx) => isOk(p) && p.isIndexable && ctx.site.sitemapUrls.length > 0,
    checkPage: (p) => (!p.inSitemap && (!p.canonicalUrl || p.canonicalUrl === p.normalizedUrl) ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "indexability.robots_txt.missing",
    category: "indexability", severity: "low", weight: 1, scope: "site",
    title: "robots.txt not found",
    description: "A missing robots.txt is treated as 'allow all', which is fine, but you lose the ability to declare sitemaps and steer crawlers away from low-value URLs.",
    recommendation: "Add a robots.txt at the site root with at least a Sitemap: line.",
    documentationUrl: DOCS.google("crawling-indexing/robots/create-robots-txt"),
    checkSite: (ctx) => (!ctx.site.robotsTxtFound ? { pageUrl: null, evidence: {} } : null),
  }),
  defineRule({
    id: "indexability.robots_txt.blocks_all",
    category: "indexability", severity: "critical", weight: 3, scope: "site",
    title: "robots.txt disallows the whole site",
    description: "A `Disallow: /` for all user agents prevents search engines from crawling any page.",
    recommendation: "Remove the blanket disallow (often left over from staging) and re-submit the sitemap.",
    documentationUrl: DOCS.google("crawling-indexing/robots/intro"),
    checkSite: (ctx) => {
      const txt = ctx.site.robotsTxt;
      if (!txt) return null;
      const blocks = txt.split(/\n(?=\s*user-agent:)/i);
      for (const b of blocks) {
        const ua = b.match(/user-agent:\s*(\S+)/i)?.[1];
        if (ua === "*" || ua?.toLowerCase() === "googlebot") {
          if (/^\s*disallow:\s*\/\s*$/im.test(b) && !/^\s*allow:\s*\/\s*$/im.test(b)) return { pageUrl: null, evidence: { userAgent: ua, excerpt: trunc(b.trim(), 300) } };
        }
      }
      return null;
    },
  }),
  defineRule({
    id: "indexability.homepage.not_indexable",
    category: "indexability", severity: "critical", weight: 3, scope: "site",
    title: "Homepage is not indexable",
    description: "The start URL does not return a 200 indexable HTML document. Nothing else matters until this is fixed.",
    recommendation: "Ensure the homepage returns 200, has no noindex, and its canonical points to itself.",
    documentationUrl: DOCS.google("crawling-indexing/block-indexing"),
    checkSite: (ctx) => {
      const h = ctx.homepage;
      if (!h) return { pageUrl: ctx.site.finalStartUrl, evidence: { reason: "start URL not fetched", stopReason: ctx.site.stopReason } };
      if (h.statusCode !== 200 || !h.isHtml || !h.isIndexable) return { pageUrl: h.url, evidence: { statusCode: h.statusCode, isHtml: h.isHtml, isIndexable: h.isIndexable, fetchClass: h.fetchClass } };
      return null;
    },
  }),
  defineRule({
    id: "indexability.url.uppercase_or_spaces",
    category: "indexability", severity: "notice", weight: 1, scope: "page",
    title: "URL contains uppercase letters or encoded spaces",
    description: "Mixed-case paths create duplicate URL variants on case-sensitive servers; encoded spaces are hard to share and read.",
    recommendation: "Use lowercase, hyphen-separated URL paths and redirect other variants.",
    documentationUrl: DOCS.google("crawling-indexing/url-structure"),
    checkPage: (p) => {
      const path = pathOf(p.normalizedUrl);
      return /[A-Z]|%20/.test(path) ? { pageUrl: p.url, evidence: { path } } : null;
    },
  }),
  defineRule({
    id: "indexability.url.too_long",
    category: "indexability", severity: "notice", weight: 1, scope: "page",
    title: "URL is very long",
    description: "URLs over ~115 characters are truncated in SERPs and often signal parameter bloat.",
    recommendation: "Prefer short descriptive slugs and avoid unnecessary query parameters.",
    documentationUrl: DOCS.google("crawling-indexing/url-structure"),
    checkPage: (p) => (p.normalizedUrl.length > 115 ? { pageUrl: p.url, evidence: { length: p.normalizedUrl.length } } : null),
  }),
];

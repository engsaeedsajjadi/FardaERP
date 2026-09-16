import { DOCS, defineRule, isOk } from "./_helpers";
import type { RuleDefinition } from "../types";

export const SLOW_TTFB_MS = 800;
export const SLOW_TOTAL_MS = 3000;
export const LARGE_HTML_BYTES = 300 * 1024;

export const performanceRules: RuleDefinition[] = [
  defineRule({
    id: "performance.ttfb.slow",
    category: "performance", severity: "medium", weight: 2, scope: "page",
    title: `Slow server response (TTFB > ${SLOW_TTFB_MS} ms)`,
    description: "Time to first byte measured from the crawler. Google recommends keeping server response under 800 ms; slow TTFB delays every other metric (LCP, FCP).",
    recommendation: "Add caching (CDN / full-page cache), optimise database queries and reduce server-side work on the critical path. Measure with the PageSpeed integration for field data.",
    documentationUrl: DOCS.webdev("ttfb"),
    appliesTo: (p) => isOk(p) && p.ttfbMs !== null,
    checkPage: (p) => (p.ttfbMs !== null && p.ttfbMs > SLOW_TTFB_MS ? { pageUrl: p.url, evidence: { ttfbMs: p.ttfbMs, note: "single measurement from crawler location" } } : null),
  }),
  defineRule({
    id: "performance.response.slow",
    category: "performance", severity: "low", weight: 1, scope: "page",
    title: `Slow HTML download (> ${SLOW_TOTAL_MS} ms)`,
    description: "Total time to receive the HTML document. Long downloads usually mean an oversized document or slow origin.",
    recommendation: "Enable compression, reduce inline scripts/styles and trim server-rendered markup.",
    documentationUrl: DOCS.webdev("ttfb"),
    appliesTo: (p) => isOk(p) && p.responseTimeMs !== null,
    checkPage: (p) => (p.responseTimeMs !== null && p.responseTimeMs > SLOW_TOTAL_MS ? { pageUrl: p.url, evidence: { responseTimeMs: p.responseTimeMs } } : null),
  }),
  defineRule({
    id: "performance.html.large",
    category: "performance", severity: "low", weight: 1, scope: "page",
    title: `HTML document larger than ${LARGE_HTML_BYTES / 1024} KB`,
    description: "Very large HTML delays parsing and rendering and often contains inlined data or CSS that should be external and cacheable.",
    recommendation: "Move large inline JSON/CSS to external cached files, paginate long lists and remove hidden markup.",
    documentationUrl: DOCS.webdev("optimize-lcp"),
    appliesTo: (p) => isOk(p) && p.byteLength !== null,
    checkPage: (p) => (p.byteLength !== null && p.byteLength > LARGE_HTML_BYTES ? { pageUrl: p.url, evidence: { bytes: p.byteLength } } : null),
  }),
  defineRule({
    id: "performance.compression.missing",
    category: "performance", severity: "medium", weight: 2, scope: "page",
    title: "HTML served without compression",
    description: "The response was not gzip/br compressed although the crawler advertised support. Compression typically cuts HTML size by 70–80%.",
    recommendation: "Enable Brotli or gzip for text/html at the web server or CDN.",
    documentationUrl: DOCS.webdev("reduce-network-payloads-using-text-compression"),
    appliesTo: (p) => isOk(p) && p.byteLength !== null && p.byteLength > 2048,
    checkPage: (p) => (!p.contentEncoding ? { pageUrl: p.url, evidence: { bytes: p.byteLength } } : null),
  }),
  defineRule({
    id: "performance.cache_control.missing",
    category: "performance", severity: "notice", weight: 1, scope: "page",
    title: "No Cache-Control header on HTML",
    description: "Without explicit caching directives intermediaries and browsers guess, which can mean either stale pages or no caching at all.",
    recommendation: "Send an explicit Cache-Control (e.g. `public, max-age=0, s-maxage=600, stale-while-revalidate=86400` for CDN-cached HTML).",
    documentationUrl: DOCS.mdn("HTTP/Headers/Cache-Control"),
    appliesTo: isOk,
    checkPage: (p) => (!p.responseHeaders["cache-control"] ? { pageUrl: p.url, evidence: {} } : null),
  }),
];

export const securityRules: RuleDefinition[] = [
  defineRule({
    id: "security.https.not_used",
    category: "security", severity: "critical", weight: 3, scope: "page",
    title: "Page served over HTTP",
    description: "HTTPS is a ranking signal and browsers mark HTTP pages as 'Not secure'. Everything sent between user and site is readable in transit.",
    recommendation: "Install a TLS certificate, redirect all HTTP URLs to HTTPS with a 301 and update internal links and canonicals.",
    documentationUrl: DOCS.google("crawling-indexing/https-best-practices"),
    appliesTo: isOk,
    checkPage: (p) => (!p.isHttps ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "security.https.no_redirect_from_http",
    category: "security", severity: "high", weight: 2, scope: "site",
    title: "HTTP version of the homepage does not redirect to HTTPS",
    description: "The crawl started from or discovered an http:// homepage that serves content instead of redirecting, creating a duplicate insecure site.",
    recommendation: "Add a server-level 301 from http:// to https:// for every URL.",
    documentationUrl: DOCS.google("crawling-indexing/https-best-practices"),
    checkSite: (ctx) => {
      const httpHome = ctx.pages.find((p) => !p.isHttps && p.depth === 0 && p.statusCode === 200 && p.isHtml);
      return httpHome ? { pageUrl: httpHome.url, evidence: { statusCode: httpHome.statusCode } } : null;
    },
  }),
  defineRule({
    id: "security.mixed_content",
    category: "security", severity: "high", weight: 2, scope: "page",
    title: "Mixed content (HTTP resources on an HTTPS page)",
    description: "Scripts, styles or images loaded over HTTP on an HTTPS page are blocked or flagged by browsers, breaking functionality and the padlock.",
    recommendation: "Load every sub-resource over HTTPS (protocol-relative or absolute https URLs) and add `Content-Security-Policy: upgrade-insecure-requests` as a safety net.",
    documentationUrl: DOCS.webdev("what-is-mixed-content"),
    appliesTo: (p) => isOk(p) && p.isHttps,
    checkPage: (p) => (p.mixedContent.length ? { pageUrl: p.url, evidence: { count: p.mixedContent.length, examples: p.mixedContent.slice(0, 5) } } : null),
  }),
  defineRule({
    id: "security.headers.hsts_missing",
    category: "security", severity: "low", weight: 1, scope: "page",
    title: "Missing Strict-Transport-Security header",
    description: "HSTS tells browsers to always use HTTPS for your domain, preventing downgrade attacks and the initial insecure request.",
    recommendation: "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` once all subdomains support HTTPS.",
    documentationUrl: DOCS.mdn("HTTP/Headers/Strict-Transport-Security"),
    appliesTo: (p) => isOk(p) && p.isHttps,
    checkPage: (p) => (!p.responseHeaders["strict-transport-security"] ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "security.headers.content_type_options_missing",
    category: "security", severity: "notice", weight: 1, scope: "page",
    title: "Missing X-Content-Type-Options: nosniff",
    description: "Without nosniff, browsers may MIME-sniff responses and execute content as script.",
    recommendation: "Send `X-Content-Type-Options: nosniff` on all responses.",
    documentationUrl: DOCS.mdn("HTTP/Headers/X-Content-Type-Options"),
    appliesTo: isOk,
    checkPage: (p) => (!p.responseHeaders["x-content-type-options"] ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "security.headers.frame_protection_missing",
    category: "security", severity: "notice", weight: 1, scope: "page",
    title: "No clickjacking protection (X-Frame-Options / CSP frame-ancestors)",
    description: "Pages that can be framed by any origin are vulnerable to clickjacking.",
    recommendation: "Send `Content-Security-Policy: frame-ancestors 'self'` (preferred) or `X-Frame-Options: SAMEORIGIN`.",
    documentationUrl: DOCS.mdn("HTTP/Headers/X-Frame-Options"),
    appliesTo: isOk,
    checkPage: (p) => (!p.responseHeaders["x-frame-options"] && !/frame-ancestors/i.test(p.responseHeaders["content-security-policy"] ?? "") ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "security.headers.server_version_exposed",
    category: "security", severity: "notice", weight: 1, scope: "site",
    title: "Server software version exposed in headers",
    description: "Server or X-Powered-By headers reveal exact software versions that make targeted attacks easier.",
    recommendation: "Configure the web server/framework to omit version details (e.g. `server_tokens off`, remove X-Powered-By).",
    documentationUrl: "https://owasp.org/www-project-secure-headers/",
    checkSite: (ctx) => {
      const h = ctx.homepage;
      if (!h) return null;
      const server = h.responseHeaders["server"] ?? "";
      const powered = h.responseHeaders["x-powered-by"] ?? "";
      const versioned = /\d+\.\d+/.test(server) || /\d+\.\d+/.test(powered);
      return versioned ? { pageUrl: h.url, evidence: { server: server || undefined, xPoweredBy: powered || undefined } } : null;
    },
  }),
];

export const mobileRules: RuleDefinition[] = [
  defineRule({
    id: "mobile.viewport.missing",
    category: "mobile", severity: "high", weight: 3, scope: "page",
    title: "Missing viewport meta tag",
    description: "Without a viewport meta tag mobile browsers render the page at desktop width, producing tiny text and horizontal scrolling. Google indexes the mobile version first.",
    recommendation: "Add `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">` to the <head>.",
    documentationUrl: DOCS.google("crawling-indexing/mobile/mobile-sites-mobile-first-indexing"),
    checkPage: (p) => (!p.viewportMeta ? { pageUrl: p.url, evidence: {} } : null),
  }),
];

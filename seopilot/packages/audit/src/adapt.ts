/** Adapters from crawler output to audit input (kept separate so the engine has no crawler runtime dependency). */
import type { CrawledPage, CrawlSummary } from "@seopilot/crawler";
import type { AuditInput, AuditPage, AuditSite } from "./types";

export function crawledPageToAuditPage(p: CrawledPage, sitemapSet: Set<string>): AuditPage {
  const a = p.analysis;
  return {
    url: p.url,
    normalizedUrl: p.normalizedUrl,
    depth: p.depth,
    discoverySource: p.discoverySource,
    statusCode: p.statusCode,
    fetchClass: p.fetchClass,
    isHtml: p.isHtml,
    redirectUrl: p.redirectUrl,
    redirectChain: p.redirectChain,
    responseTimeMs: p.responseTimeMs,
    ttfbMs: p.ttfbMs,
    byteLength: p.byteLength,
    contentEncoding: p.contentEncoding,
    isHttps: p.isHttps,
    title: a?.title ?? null,
    metaDescription: a?.metaDescription ?? null,
    canonicalUrl: a?.canonicalUrl ?? null,
    headerCanonicalUrl: p.headerCanonicalUrl,
    robotsMeta: a?.robotsMeta ?? null,
    xRobotsTag: p.xRobotsTag,
    responseHeaders: p.responseHeaders,
    isIndexable: a?.isIndexable ?? true,
    isNofollow: a?.isNofollow ?? false,
    h1s: a?.h1s ?? [],
    headingOutline: a?.headingOutline ?? [],
    wordCount: a?.wordCount ?? 0,
    contentHash: a?.contentHash ?? null,
    lang: a?.lang ?? null,
    hreflang: a?.hreflang ?? [],
    ogTitle: a?.ogTitle ?? null,
    ogDescription: a?.ogDescription ?? null,
    ogImage: a?.ogImage ?? null,
    imageCount: a?.imageCount ?? 0,
    imagesMissingAlt: a?.imagesMissingAlt ?? 0,
    images: a?.images ?? [],
    internalLinkCount: a?.internalLinkCount ?? 0,
    externalLinkCount: a?.externalLinkCount ?? 0,
    structuredData: a?.structuredData ?? [],
    mixedContent: a?.mixedContent ?? [],
    viewportMeta: a?.viewportMeta ?? false,
    renderedWithJs: p.renderedWithJs,
    inSitemap: sitemapSet.has(p.normalizedUrl),
    links: (a?.links ?? []).map((l) => ({ targetNormalizedUrl: l.normalized, anchor: l.anchor, isInternal: l.isInternal, isNofollow: l.isNofollow })),
  };
}

export function crawlToAuditInput(summary: CrawlSummary, pages: CrawledPage[]): AuditInput {
  const sitemapSet = new Set(summary.sitemapEntries.map((e) => e.normalizedUrl));
  const site: AuditSite = {
    startUrl: summary.startUrl,
    finalStartUrl: summary.finalStartUrl,
    robotsTxtFound: summary.robotsTxtFound,
    robotsTxt: summary.robotsTxt,
    sitemapUrls: summary.sitemapUrls,
    sitemapEntries: summary.sitemapEntries.map((e) => ({ url: e.url, normalizedUrl: e.normalizedUrl, lastmod: e.lastmod })),
    stopReason: summary.stopReason,
  };
  return { site, pages: pages.map((p) => crawledPageToAuditPage(p, sitemapSet)), externalLinkStatus: summary.externalLinkStatus };
}

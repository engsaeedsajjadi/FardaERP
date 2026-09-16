/**
 * HTML analysis: extracts every on-page signal the audit rules need from one
 * document. Cheerio is used (RosterSeo pattern); OpenSEO's streaming approach
 * was designed around Cloudflare's 128 MB isolates — the worker process here
 * bounds memory by capping response size (safeFetch maxBytes) instead.
 */
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { normalizeUrl, sameSite } from "./url";
import { extractStructuredData } from "./structured-data";
import type { PageAnalysis, PageLink } from "./types";

const MAX_LINKS = 2000;
const MAX_IMAGES = 1000;
const TEXT_SAMPLE_CHARS = 4000;

function clean(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}

export function analyzeHtml(html: string, pageUrl: string): PageAnalysis {
  const $ = cheerio.load(html);
  const isHttpsPage = pageUrl.startsWith("https://");
  const baseHref = $("base[href]").attr("href");
  const base = baseHref ? (normalizeUrl(baseHref, pageUrl) ?? pageUrl) : pageUrl;

  const title = clean($("head > title").first().text()) ?? clean($("title").first().text());
  const metaDescription = clean($('meta[name="description"]').attr("content"));
  const robotsMeta = clean(
    $('meta[name="robots"], meta[name="googlebot"]')
      .map((_, el) => $(el).attr("content"))
      .get()
      .join(", "),
  );
  const robotsTokens = (robotsMeta ?? "").toLowerCase().split(/[,\s]+/).filter(Boolean);
  const canonicalHref = $('link[rel="canonical"]').first().attr("href");
  const canonicalUrl = canonicalHref ? normalizeUrl(canonicalHref, base) : null;

  const headingOutline: Array<{ level: number; text: string }> = [];
  const h1s: string[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = Number(el.tagName.slice(1));
    const text = clean($(el).text()) ?? "";
    if (headingOutline.length < 500) headingOutline.push({ level, text: text.slice(0, 300) });
    if (level === 1) h1s.push(text.slice(0, 300));
  });

  // Visible text: strip non-content elements.
  const bodyClone = $("body").clone();
  bodyClone.find("script, style, noscript, svg, template, iframe").remove();
  const bodyText = (bodyClone.text() || "").replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  const contentHash = createHash("sha1").update(bodyText.toLowerCase()).digest("hex");

  const images: Array<{ src: string; alt: string | null }> = [];
  let imagesMissingAlt = 0;
  let imageCount = 0;
  $("img").each((_, el) => {
    imageCount++;
    const src = $(el).attr("src") ?? $(el).attr("data-src") ?? "";
    const altAttr = $(el).attr("alt");
    const alt = altAttr === undefined ? null : altAttr.trim();
    if (alt === null) imagesMissingAlt++;
    if (images.length < MAX_IMAGES) images.push({ src: normalizeUrl(src, base) ?? src.slice(0, 500), alt });
  });

  const linkMap = new Map<string, PageLink>();
  $("a[href]").each((_, el) => {
    if (linkMap.size >= MAX_LINKS) return false;
    const href = String($(el).attr("href") ?? "").trim();
    if (!href || /^(javascript:|mailto:|tel:|sms:|data:|#)/i.test(href)) return;
    const normalized = normalizeUrl(href, base);
    if (!normalized) return;
    if (linkMap.has(normalized)) return;
    const rel = clean($(el).attr("rel"));
    const relTokens = (rel ?? "").toLowerCase().split(/\s+/);
    linkMap.set(normalized, {
      href: href.slice(0, 2000),
      normalized,
      anchor: (clean($(el).text()) ?? clean($(el).find("img").attr("alt")) ?? null)?.slice(0, 300) ?? null,
      rel,
      isInternal: sameSite(normalized, pageUrl),
      isNofollow: relTokens.includes("nofollow") || relTokens.includes("ugc") || relTokens.includes("sponsored"),
    });
    return;
  });
  const links = [...linkMap.values()];

  const hreflang: Array<{ lang: string; href: string }> = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = String($(el).attr("hreflang") ?? "").trim();
    const href = normalizeUrl(String($(el).attr("href") ?? ""), base);
    if (lang && href && hreflang.length < 200) hreflang.push({ lang, href });
  });

  const mixedContent: string[] = [];
  if (isHttpsPage) {
    $("img[src], script[src], link[rel='stylesheet'][href], iframe[src], video[src], audio[src], source[src]").each((_, el) => {
      const v = String($(el).attr("src") ?? $(el).attr("href") ?? "");
      if (/^http:\/\//i.test(v) && mixedContent.length < 50) mixedContent.push(v.slice(0, 500));
    });
  }

  const prev = $('link[rel="prev"]').attr("href");
  const next = $('link[rel="next"]').attr("href");
  const paginationRel = prev || next ? { prev: prev ? normalizeUrl(prev, base) : null, next: next ? normalizeUrl(next, base) : null } : null;

  const scripts: string[] = [];
  const stylesheets: string[] = [];
  $("script[src]").each((_, el) => {
    const u = normalizeUrl(String($(el).attr("src")), base);
    if (u && scripts.length < 200) scripts.push(u);
  });
  $('link[rel="stylesheet"][href]').each((_, el) => {
    const u = normalizeUrl(String($(el).attr("href")), base);
    if (u && stylesheets.length < 100) stylesheets.push(u);
  });

  return {
    title,
    metaDescription,
    canonicalUrl,
    robotsMeta,
    isIndexable: !robotsTokens.includes("noindex") && !robotsTokens.includes("none"),
    isNofollow: robotsTokens.includes("nofollow") || robotsTokens.includes("none"),
    h1s,
    headingOutline,
    wordCount,
    contentHash,
    lang: clean($("html").attr("lang")),
    hreflang,
    ogTitle: clean($('meta[property="og:title"]').attr("content")),
    ogDescription: clean($('meta[property="og:description"]').attr("content")),
    ogImage: clean($('meta[property="og:image"]').attr("content")),
    images,
    imageCount,
    imagesMissingAlt,
    links,
    internalLinkCount: links.filter((l) => l.isInternal).length,
    externalLinkCount: links.filter((l) => !l.isInternal).length,
    structuredData: extractStructuredData($),
    mixedContent,
    paginationRel,
    viewportMeta: $('meta[name="viewport"]').length > 0,
    textSample: bodyText.slice(0, TEXT_SAMPLE_CHARS),
    resourceUrls: { scripts, stylesheets },
  };
}

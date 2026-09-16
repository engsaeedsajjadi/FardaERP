/**
 * Sitemap discovery and parsing (spec §23): robots.txt Sitemap: lines plus
 * the conventional /sitemap.xml and /sitemap_index.xml, sitemap index
 * recursion, gzip support (handled transparently by safeFetch on
 * Content-Encoding; .gz payloads are gunzipped here), and bounded totals.
 */
import { gunzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import { safeFetch, type SsrfPolicy } from "@seopilot/security";
import { normalizeUrl } from "./url";

export interface SitemapEntry {
  sitemapUrl: string;
  url: string;
  normalizedUrl: string;
  lastmod: string | null;
  changefreq: string | null;
  priority: number | null;
}

export interface SitemapResult {
  sitemaps: Array<{ url: string; status: number | null; entries: number; error: string | null; isIndex: boolean }>;
  entries: SitemapEntry[];
}

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, isArray: (name) => name === "url" || name === "sitemap" });

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

export async function fetchSitemaps(input: { siteOrigin: string; candidates: string[]; userAgent: string; policy?: SsrfPolicy; maxSitemaps?: number; maxEntries?: number; timeoutMs?: number }): Promise<SitemapResult> {
  const maxSitemaps = input.maxSitemaps ?? 50;
  const maxEntries = input.maxEntries ?? 50_000;
  const queue = [...new Set([...input.candidates, new URL("/sitemap.xml", input.siteOrigin).toString(), new URL("/sitemap_index.xml", input.siteOrigin).toString()])];
  const seen = new Set<string>();
  const result: SitemapResult = { sitemaps: [], entries: [] };
  const seenUrls = new Set<string>();

  while (queue.length && result.sitemaps.length < maxSitemaps && result.entries.length < maxEntries) {
    const smUrl = queue.shift() as string;
    if (seen.has(smUrl)) continue;
    seen.add(smUrl);
    try {
      const res = await safeFetch(smUrl, { headers: { "user-agent": input.userAgent, accept: "application/xml,text/xml,*/*" }, timeoutMs: input.timeoutMs ?? 15_000, maxBytes: 20 * 1024 * 1024, policy: input.policy });
      if (!res.ok) {
        // Conventional fallbacks that 404 are not errors worth reporting.
        if (input.candidates.includes(smUrl)) result.sitemaps.push({ url: smUrl, status: res.status, entries: 0, error: `HTTP ${res.status}`, isIndex: false });
        continue;
      }
      let body = res.body;
      if (smUrl.endsWith(".gz") || (body[0] === 0x1f && body[1] === 0x8b)) {
        try {
          body = gunzipSync(body, { maxOutputLength: 50 * 1024 * 1024 });
        } catch {
          result.sitemaps.push({ url: smUrl, status: res.status, entries: 0, error: "invalid gzip", isIndex: false });
          continue;
        }
      }
      const text = body.toString("utf8");
      if (text.trimStart().startsWith("<")) {
        const xml = parser.parse(text) as Record<string, unknown>;
        const index = xml["sitemapindex"] as { sitemap?: Array<{ loc?: string }> } | undefined;
        if (index) {
          const children = asArray(index.sitemap).map((s) => s.loc).filter((x): x is string => typeof x === "string");
          children.forEach((c) => queue.push(c.trim()));
          result.sitemaps.push({ url: smUrl, status: res.status, entries: children.length, error: null, isIndex: true });
          continue;
        }
        const urlset = xml["urlset"] as { url?: Array<{ loc?: string; lastmod?: string; changefreq?: string; priority?: string | number }> } | undefined;
        if (!urlset) {
          result.sitemaps.push({ url: smUrl, status: res.status, entries: 0, error: "not a sitemap (no <urlset>)", isIndex: false });
          continue;
        }
        let count = 0;
        for (const u of asArray(urlset.url)) {
          if (!u.loc || result.entries.length >= maxEntries) continue;
          const normalized = normalizeUrl(String(u.loc).trim(), smUrl);
          if (!normalized || seenUrls.has(normalized)) continue;
          seenUrls.add(normalized);
          result.entries.push({ sitemapUrl: smUrl, url: String(u.loc).trim(), normalizedUrl: normalized, lastmod: u.lastmod ? String(u.lastmod) : null, changefreq: u.changefreq ? String(u.changefreq) : null, priority: u.priority !== undefined ? Number(u.priority) : null });
          count++;
        }
        result.sitemaps.push({ url: smUrl, status: res.status, entries: count, error: null, isIndex: false });
      } else {
        // Plain-text sitemap: one URL per line.
        let count = 0;
        for (const line of text.split(/\r?\n/)) {
          const l = line.trim();
          if (!l || !/^https?:\/\//i.test(l) || result.entries.length >= maxEntries) continue;
          const normalized = normalizeUrl(l);
          if (!normalized || seenUrls.has(normalized)) continue;
          seenUrls.add(normalized);
          result.entries.push({ sitemapUrl: smUrl, url: l, normalizedUrl: normalized, lastmod: null, changefreq: null, priority: null });
          count++;
        }
        result.sitemaps.push({ url: smUrl, status: res.status, entries: count, error: count ? null : "empty", isIndex: false });
      }
    } catch (err) {
      if (input.candidates.includes(smUrl)) result.sitemaps.push({ url: smUrl, status: null, entries: 0, error: err instanceof Error ? err.message : String(err), isIndex: false });
    }
  }
  return result;
}

/** Sitemap health analysis over parsed entries (lastmod validity, future dates, staleness). */
export function analyzeSitemapEntries(entries: SitemapEntry[], now = new Date()): { invalidLastmod: number; futureLastmod: number; staleOver1y: number; withLastmod: number } {
  let invalidLastmod = 0, futureLastmod = 0, staleOver1y = 0, withLastmod = 0;
  const yearAgo = now.getTime() - 365 * 86400_000;
  for (const e of entries) {
    if (!e.lastmod) continue;
    withLastmod++;
    const t = Date.parse(e.lastmod);
    if (Number.isNaN(t)) invalidLastmod++;
    else if (t > now.getTime() + 86400_000) futureLastmod++;
    else if (t < yearAgo) staleOver1y++;
  }
  return { invalidLastmod, futureLastmod, staleOver1y, withLastmod };
}

/**
 * Breadth-first site crawler with a bounded frontier, per-host concurrency,
 * politeness delay, robots.txt, sitemap seeding and an overall wall-clock
 * budget. Pages are streamed to `events.onPage` as they complete so the caller
 * (worker) persists incrementally and memory stays flat regardless of site size.
 */
import { Semaphore, safeFetch, type SsrfPolicy } from "@seopilot/security";
import { sleep } from "@seopilot/shared";
import { fetchPage } from "./fetch-page";
import { fetchRobots } from "./robots";
import { fetchSitemaps } from "./sitemap";
import { isSubdomainOf, looksLikeAsset, matchesPatterns, normalizeUrl, sameSite } from "./url";
import { isRenderingAvailable, renderPage } from "./render";
import { analyzeHtml } from "./analyze";
import type { CrawlEvents, CrawlOptions, CrawlSummary, CrawledPage, DiscoverySource } from "./types";

interface FrontierItem {
  url: string;
  depth: number;
  from: string | null;
  source: DiscoverySource;
}

export const DEFAULT_CRAWL_OPTIONS: Omit<CrawlOptions, "startUrl"> = {
  maxPages: 500,
  maxDepth: 10,
  concurrency: 4,
  delayMs: 250,
  respectRobots: true,
  renderJavaScript: false,
  userAgent: "SEOPilotBot/1.0 (+https://seopilot.dev/bot)",
  includePatterns: [],
  excludePatterns: [],
  checkExternalLinks: true,
  maxExternalChecks: 200,
  timeoutMs: 20_000,
  maxBytes: 5 * 1024 * 1024,
  maxDurationMs: 60 * 60_000,
};

/** Resolve the real start origin by following redirects on the start URL (apex→www, http→https). */
export async function resolveStartUrl(startUrl: string, userAgent: string, policy?: SsrfPolicy): Promise<{ url: string; chain: Array<{ url: string; status: number }>; status: number | null; error: string | null }> {
  try {
    const res = await safeFetch(startUrl, { method: "GET", headers: { "user-agent": userAgent }, timeoutMs: 15_000, maxBytes: 1024 * 1024, maxRedirects: 8, policy });
    return { url: res.url, chain: res.redirectChain, status: res.status, error: null };
  } catch (err) {
    return { url: startUrl, chain: [], status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function crawlSite(optionsIn: Partial<CrawlOptions> & { startUrl: string }, events: CrawlEvents = {}): Promise<CrawlSummary> {
  const opts: CrawlOptions = { ...DEFAULT_CRAWL_OPTIONS, ...optionsIn };
  const startedAt = Date.now();
  const policy: SsrfPolicy = { allowHosts: opts.allowHosts, allowPorts: opts.allowPorts };
  const log = events.onLog ?? (() => undefined);

  const resolved = await resolveStartUrl(opts.startUrl, opts.userAgent, policy);
  const finalStart = normalizeUrl(resolved.url) ?? opts.startUrl;
  const origin = new URL(finalStart).origin;
  if (resolved.error) log("warn", "start url unreachable", { error: resolved.error });

  const robots = await fetchRobots(origin, opts.userAgent, policy);
  const robotsDelay = robots.crawlDelay(opts.userAgent);
  const delayMs = Math.max(opts.delayMs, robotsDelay ? Math.min(robotsDelay * 1000, 10_000) : 0);

  const sitemaps = await fetchSitemaps({ siteOrigin: origin, candidates: robots.sitemaps, userAgent: opts.userAgent, policy, maxEntries: Math.max(opts.maxPages * 4, 5000) });
  log("info", "crawl start", { finalStart, robotsFound: robots.found, sitemapUrls: sitemaps.entries.length });

  const seen = new Set<string>();
  const queue: FrontierItem[] = [];
  const enqueue = (url: string, depth: number, from: string | null, source: DiscoverySource): boolean => {
    const n = normalizeUrl(url);
    if (!n || seen.has(n)) return false;
    if (!isSubdomainOf(n, finalStart) && !sameSite(n, finalStart)) return false;
    if (looksLikeAsset(n)) return false;
    if (depth > opts.maxDepth) return false;
    if (opts.excludePatterns.length && matchesPatterns(n, opts.excludePatterns)) return false;
    if (opts.includePatterns.length && !matchesPatterns(n, opts.includePatterns) && source !== "start") return false;
    seen.add(n);
    queue.push({ url: n, depth, from, source });
    return true;
  };

  enqueue(finalStart, 0, null, "start");
  // Sitemap URLs are seeded at depth 1 so orphan detection can still distinguish "only in sitemap".
  for (const e of sitemaps.entries) {
    if (seen.size >= opts.maxPages * 3) break;
    enqueue(e.normalizedUrl, 1, e.sitemapUrl, "sitemap");
  }

  const semaphore = new Semaphore(opts.concurrency);
  let crawled = 0, failed = 0, inFlight = 0;
  let stopReason: CrawlSummary["stopReason"] = "frontier_exhausted";
  let startFailed = false;
  const externalTargets = new Set<string>();
  const renderAvailable = opts.renderJavaScript ? await isRenderingAvailable() : false;
  if (opts.renderJavaScript && !renderAvailable) log("warn", "JavaScript rendering requested but Playwright is not available; crawling raw HTML");
  let lastRequestAt = 0;

  const processOne = async (item: FrontierItem): Promise<void> => {
    if (opts.respectRobots && !robots.isAllowed(item.url, opts.userAgent)) {
      const page: CrawledPage = {
        url: item.url, normalizedUrl: item.url, depth: item.depth, discoveredFrom: item.from, discoverySource: item.source, statusCode: null, fetchClass: "skipped_robots",
        contentType: null, isHtml: false, redirectUrl: null, redirectChain: [], responseTimeMs: null, ttfbMs: null, byteLength: null, contentEncoding: null,
        isHttps: item.url.startsWith("https://"), headerCanonicalUrl: null, xRobotsTag: null, responseHeaders: {}, renderedWithJs: false, errorMessage: "Disallowed by robots.txt", analysis: null,
      };
      crawled++;
      await events.onPage?.(page);
      return;
    }
    // Politeness: global spacing between request starts.
    const wait = lastRequestAt + delayMs - Date.now();
    if (wait > 0) await sleep(wait, opts.signal).catch(() => undefined);
    lastRequestAt = Date.now();

    const page = await fetchPage({ url: item.url, depth: item.depth, discoveredFrom: item.from, discoverySource: item.source, userAgent: opts.userAgent, timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes, policy, signal: opts.signal });

    if (renderAvailable && page.isHtml && page.statusCode === 200 && page.analysis && page.analysis.wordCount < 50) {
      // Only render when raw HTML looks like an empty shell: saves cost and avoids double-counting.
      try {
        const rendered = await renderPage(item.url, { userAgent: opts.userAgent, policy });
        page.analysis = analyzeHtml(rendered.html, item.url);
        page.renderedWithJs = true;
      } catch (err) {
        log("warn", "render failed", { url: item.url, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (page.fetchClass !== "ok" && page.fetchClass !== "redirect") failed++;
    if (item.source === "start" && page.fetchClass !== "ok" && page.fetchClass !== "redirect") startFailed = true;
    crawled++;
    if (page.redirectUrl) enqueue(page.redirectUrl, item.depth, item.url, "redirect");
    if (page.analysis) {
      for (const link of page.analysis.links) {
        if (link.isInternal || isSubdomainOf(link.normalized, finalStart)) enqueue(link.normalized, item.depth + 1, item.url, "link");
        else if (opts.checkExternalLinks && externalTargets.size < opts.maxExternalChecks) externalTargets.add(link.normalized);
      }
      if (page.analysis.canonicalUrl) enqueue(page.analysis.canonicalUrl, item.depth + 1, item.url, "canonical");
      for (const h of page.analysis.hreflang) enqueue(h.href, item.depth + 1, item.url, "hreflang");
    }
    await events.onPage?.(page);
  };

  const running = new Set<Promise<void>>();
  while (true) {
    if (opts.signal?.aborted) { stopReason = "aborted"; break; }
    if (Date.now() - startedAt > opts.maxDurationMs) { stopReason = "max_duration"; break; }
    if (crawled + inFlight >= opts.maxPages) { stopReason = "max_pages"; if (inFlight === 0) break; await Promise.race(running); continue; }
    const item = queue.shift();
    if (!item) {
      if (inFlight === 0) break;
      await Promise.race(running);
      continue;
    }
    const release = await semaphore.acquire();
    inFlight++;
    const p = processOne(item)
      .catch((err) => log("warn", "page failed", { url: item.url, error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        inFlight--;
        release();
        running.delete(p);
        events.onProgress?.({ crawled, discovered: seen.size, failed, inFlight });
      });
    running.add(p);
  }
  await Promise.allSettled([...running]);
  if (stopReason === "frontier_exhausted" && (crawled === 0 || startFailed)) stopReason = "start_url_failed";

  // Bounded external link status checks (HEAD, fall back to GET on 405).
  const externalLinkStatus = new Map<string, number | null>();
  if (opts.checkExternalLinks && externalTargets.size) {
    const extSem = new Semaphore(Math.min(opts.concurrency, 4));
    await Promise.all(
      [...externalTargets].map(async (u) => {
        const rel = await extSem.acquire();
        try {
          if (Date.now() - startedAt > opts.maxDurationMs) return;
          let r = await safeFetch(u, { method: "HEAD", headers: { "user-agent": opts.userAgent }, timeoutMs: 10_000, maxBytes: 64 * 1024, policy: {} }).catch(() => null);
          if (r && (r.status === 405 || r.status === 501)) r = await safeFetch(u, { method: "GET", headers: { "user-agent": opts.userAgent }, timeoutMs: 10_000, maxBytes: 64 * 1024, policy: {} }).catch(() => null);
          externalLinkStatus.set(u, r ? r.status : null);
        } finally {
          rel();
        }
      }),
    );
  }

  return {
    startUrl: opts.startUrl,
    finalStartUrl: finalStart,
    pagesCrawled: crawled,
    pagesDiscovered: seen.size,
    pagesFailed: failed,
    stopReason,
    robotsTxt: robots.body,
    robotsTxtFound: robots.found,
    sitemapUrls: sitemaps.sitemaps.filter((s) => !s.error).map((s) => s.url),
    sitemapEntries: sitemaps.entries,
    externalLinkStatus,
    durationMs: Date.now() - startedAt,
  };
}

/** Set of normalized URLs listed in any sitemap (used by orphan-page rules). */
export function sitemapUrlSet(summary: CrawlSummary): Set<string> {
  return new Set(summary.sitemapEntries.map((e) => e.normalizedUrl));
}

import { safeFetch, SafeFetchError, type SsrfPolicy } from "@seopilot/security";
import { analyzeHtml } from "./analyze";
import { normalizeUrl } from "./url";
import type { CrawledPage, DiscoverySource, FetchClass } from "./types";

export interface FetchPageInput {
  url: string;
  depth: number;
  discoveredFrom: string | null;
  discoverySource: DiscoverySource;
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  policy?: SsrfPolicy;
  signal?: AbortSignal;
}

function classify(status: number): FetchClass {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "blocked";
  if (status >= 400 && status < 500) return "client_error";
  if (status >= 500) return "server_error";
  return "network_error";
}

const AUDIT_HEADERS = ["strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "cache-control", "vary", "server", "x-powered-by", "content-language", "last-modified", "etag", "set-cookie"];

function pickHeaders(headers: { get(name: string): string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of AUDIT_HEADERS) {
    const v = headers.get(h);
    if (v !== null) out[h] = h === "set-cookie" ? v.replace(/=[^;]*/g, "=<redacted>").slice(0, 500) : v.slice(0, 1000);
  }
  return out;
}

function parseLinkHeaderCanonical(header: string | null, base: string): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*(.*)/);
    if (!m) continue;
    if (/rel\s*=\s*"?canonical"?/i.test(m[2] as string)) return normalizeUrl((m[1] as string).trim(), base);
  }
  return null;
}

/** Fetch one URL (manual redirect handling so each hop is recorded and re-validated) and analyse HTML. */
export async function fetchPage(input: FetchPageInput): Promise<CrawledPage> {
  const normalizedUrl = normalizeUrl(input.url) ?? input.url;
  const basePage: CrawledPage = {
    url: input.url,
    normalizedUrl,
    depth: input.depth,
    discoveredFrom: input.discoveredFrom,
    discoverySource: input.discoverySource,
    statusCode: null,
    fetchClass: "network_error",
    contentType: null,
    isHtml: false,
    redirectUrl: null,
    redirectChain: [],
    responseTimeMs: null,
    ttfbMs: null,
    byteLength: null,
    contentEncoding: null,
    isHttps: input.url.startsWith("https://"),
    headerCanonicalUrl: null,
    xRobotsTag: null,
    responseHeaders: {},
    renderedWithJs: false,
    errorMessage: null,
    analysis: null,
  };

  let res;
  try {
    res = await safeFetch(input.url, {
      headers: { "user-agent": input.userAgent, "accept-language": "en-US,en;q=0.8" },
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
      redirect: "manual",
      policy: input.policy,
      signal: input.signal,
    });
  } catch (err) {
    if (err instanceof SafeFetchError) {
      const map: Record<string, FetchClass> = { ssrf_blocked: "ssrf_blocked", timeout: "timeout", response_too_large: "too_large", too_many_redirects: "redirect", network_error: "network_error", tls_error: "network_error" };
      return { ...basePage, fetchClass: map[err.code] ?? "network_error", errorMessage: `${err.code}: ${err.message}`.slice(0, 500) };
    }
    return { ...basePage, errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500) };
  }

  const status = res.status;
  const contentType = res.headers.get("content-type");
  const isHtml = Boolean(contentType && /text\/html|application\/xhtml\+xml/i.test(contentType));
  const location = res.headers.get("location");
  const redirectUrl = status >= 300 && status < 400 && location ? (normalizeUrl(location, input.url) ?? location) : null;
  const xRobots = res.headers.get("x-robots-tag");
  const fetchClass = classify(status);

  const page: CrawledPage = {
    ...basePage,
    statusCode: status,
    fetchClass,
    contentType,
    isHtml,
    redirectUrl,
    redirectChain: res.redirectChain,
    responseTimeMs: res.totalMs,
    ttfbMs: res.ttfbMs,
    byteLength: res.byteLength,
    contentEncoding: res.contentEncoding,
    headerCanonicalUrl: parseLinkHeaderCanonical(res.headers.get("link"), input.url),
    xRobotsTag: xRobots,
    responseHeaders: pickHeaders(res.headers),
  };

  if (isHtml && status >= 200 && status < 300 && res.byteLength > 0) {
    const analysis = analyzeHtml(res.text(), input.url);
    // X-Robots-Tag header overrides/combines with meta robots.
    if (xRobots) {
      const tokens = xRobots.toLowerCase();
      if (/noindex|none/.test(tokens)) analysis.isIndexable = false;
      if (/nofollow|none/.test(tokens)) analysis.isNofollow = true;
    }
    page.analysis = analysis;
  }
  // Bot challenge pages (Cloudflare etc.) return 403/503 with HTML mentioning a challenge.
  if ((status === 403 || status === 503) && isHtml) {
    const t = res.text().slice(0, 5000).toLowerCase();
    if (/cf-challenge|attention required|just a moment|access denied|captcha|bot detection/.test(t)) page.fetchClass = "blocked";
  }
  return page;
}

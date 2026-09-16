/**
 * URL normalisation for crawl frontier de-duplication. Behaviour matches what
 * search engines treat as equivalent: scheme/host lowercased, default ports
 * removed, fragment dropped, tracking parameters removed, query keys sorted,
 * trailing slash on bare paths normalised, dot segments resolved.
 */
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "gclid", "dclid", "fbclid", "msclkid", "mc_cid", "mc_eid",
  "_ga", "_gl", "yclid", "igshid", "ref", "source", "sessionid", "phpsessid", "jsessionid", "sid",
]);

export function normalizeUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [k, v] of params) url.searchParams.append(k, v);
  // Percent-encoding normalisation happens in URL; collapse duplicate slashes in path.
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname === "") url.pathname = "/";
  return url.toString();
}

export function sameSite(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.hostname.replace(/^www\./, "") === ub.hostname.replace(/^www\./, "") && ua.port === ub.port;
  } catch {
    return false;
  }
}

export function isSubdomainOf(candidate: string, root: string): boolean {
  try {
    const uc = new URL(candidate);
    const ur = new URL(root);
    if (uc.port !== ur.port) return false;
    const hc = uc.hostname.replace(/^www\./, "");
    const hr = ur.hostname.replace(/^www\./, "");
    return hc === hr || hc.endsWith(`.${hr}`);
  } catch {
    return false;
  }
}

const NON_HTML_EXT = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|avi|mp3|wav|ogg|zip|gz|tar|rar|7z|exe|dmg|pkg|deb|rpm|woff2?|ttf|eot|otf|css|js|mjs|json|xml|rss|atom|txt|csv|pdf|docx?|xlsx?|pptx?)(\?|$)/i;

export function looksLikeAsset(url: string): boolean {
  try {
    return NON_HTML_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Pattern matching for include/exclude rules. Patterns prefixed with `re:` are
 * regular expressions; anything else is a glob (`*` = any chars, `?` = one char)
 * matched against the full URL, or against the path when the pattern starts with `/`.
 */
export function matchesPatterns(url: string, patterns: string[]): boolean {
  let path = url;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    /* match raw */
  }
  for (const p of patterns) {
    if (!p) continue;
    if (p.startsWith("re:")) {
      try {
        if (new RegExp(p.slice(3), "i").test(url)) return true;
      } catch {
        /* invalid regex never matches */
      }
      continue;
    }
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    const re = new RegExp(`^${escaped}$`, "i");
    if (re.test(p.startsWith("/") ? path : url)) return true;
    if (!p.startsWith("/") && !p.includes("://") && new RegExp(escaped, "i").test(url)) return true;
  }
  return false;
}

export function urlDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

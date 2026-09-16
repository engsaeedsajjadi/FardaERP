import robotsParser from "robots-parser";
import { safeFetch, type SsrfPolicy } from "@seopilot/security";

export interface RobotsInfo {
  found: boolean;
  body: string | null;
  sitemaps: string[];
  isAllowed: (url: string, userAgent: string) => boolean;
  crawlDelay: (userAgent: string) => number | null;
}

export async function fetchRobots(siteOrigin: string, userAgent: string, policy?: SsrfPolicy, timeoutMs = 10_000): Promise<RobotsInfo> {
  const robotsUrl = new URL("/robots.txt", siteOrigin).toString();
  let body: string | null = null;
  let found = false;
  try {
    const res = await safeFetch(robotsUrl, { headers: { "user-agent": userAgent }, timeoutMs, maxBytes: 512 * 1024, policy });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("text")) {
      body = res.text();
      found = true;
    } else if (res.ok) {
      body = res.text();
      found = body.length > 0 && !/^\s*</.test(body);
    }
  } catch {
    // unreachable robots.txt: treat as allow-all (matches Googlebot behaviour for 5xx after retries → we are conservative but not blocking)
  }
  const parser = robotsParser(robotsUrl, body ?? "");
  const sitemaps = found ? parser.getSitemaps() : [];
  return {
    found,
    body,
    sitemaps,
    isAllowed: (url, ua) => (found ? parser.isAllowed(url, ua) !== false : true),
    crawlDelay: (ua) => {
      const d = parser.getCrawlDelay(ua);
      return typeof d === "number" && Number.isFinite(d) ? d : null;
    },
  };
}

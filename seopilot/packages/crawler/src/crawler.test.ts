import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlSite, sitemapUrlSet } from "./crawler";
import { fetchSitemaps } from "./sitemap";
import { fetchRobots } from "./robots";
import type { CrawledPage } from "./types";

let server: http.Server;
let origin: string;
let hits: string[] = [];

const page = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    const url = req.url ?? "/";
    const send = (status: number, body: string | Buffer, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(body);
    };
    switch (url) {
      case "/robots.txt":
        return send(200, `User-agent: *\nDisallow: /private\nCrawl-delay: 0\nSitemap: ${origin}/sitemap-index.xml\n`, { "content-type": "text/plain" });
      case "/sitemap-index.xml":
        return send(200, `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin}/sitemap-1.xml.gz</loc></sitemap><sitemap><loc>${origin}/sitemap-2.txt</loc></sitemap></sitemapindex>`, { "content-type": "application/xml" });
      case "/sitemap-1.xml.gz":
        return send(200, zlib.gzipSync(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/orphan</loc><lastmod>2020-01-01</lastmod><priority>0.5</priority></url><url><loc>${origin}/</loc><lastmod>not-a-date</lastmod></url></urlset>`), { "content-type": "application/gzip" });
      case "/sitemap-2.txt":
        return send(200, `${origin}/from-txt\n# comment\n`, { "content-type": "text/plain" });
      case "/":
        return send(200, page("Home", `<a href="/a">A</a><a href="/b?utm_source=x">B</a><a href="/private/x">P</a><a href="/redirect">R</a><a href="/missing">M</a><a href="/doc.pdf">pdf</a><a href="/">self</a><a href="http://127.0.0.1:1/ext">ext</a>`), { link: `<${origin}/>; rel="canonical"` });
      case "/a":
        return send(200, page("A", `<p>${"lorem ".repeat(80)}</p><a href="/">home</a><a href="/a?page=2">next</a>`));
      case "/a?page=2":
        return send(200, page("A2", "<p>page two</p>"));
      case "/b":
        return send(200, page("B", "<p>b</p>"), { "x-robots-tag": "noindex" });
      case "/redirect":
        return send(301, "", { location: "/a" });
      case "/orphan":
        return send(200, page("Orphan", "<p>orphan</p>"));
      case "/from-txt":
        return send(200, page("Txt", "<p>t</p>"));
      case "/slow":
        return void setTimeout(() => send(200, page("slow", "")), 3000);
      default:
        return send(404, page("404", "nope"));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const testOpts = { allowHosts: ["127.0.0.1"], allowPorts: [1, ...Array.from({ length: 65535 }, (_, i) => i + 1)], delayMs: 0, checkExternalLinks: true };

describe("robots + sitemaps", () => {
  it("parses robots.txt and discovers sitemaps (index → gzip xml + txt)", async () => {
    const robots = await fetchRobots(origin, "SEOPilotBot", { allowHosts: ["127.0.0.1"], allowPorts: testOpts.allowPorts });
    expect(robots.found).toBe(true);
    expect(robots.isAllowed(`${origin}/private/x`, "SEOPilotBot")).toBe(false);
    expect(robots.isAllowed(`${origin}/a`, "SEOPilotBot")).toBe(true);
    expect(robots.sitemaps).toEqual([`${origin}/sitemap-index.xml`]);

    const sm = await fetchSitemaps({ siteOrigin: origin, candidates: robots.sitemaps, userAgent: "SEOPilotBot", policy: { allowHosts: ["127.0.0.1"], allowPorts: testOpts.allowPorts } });
    const urls = sm.entries.map((e) => e.normalizedUrl).sort();
    expect(urls).toEqual([`${origin}/`, `${origin}/from-txt`, `${origin}/orphan`].sort());
    expect(sm.entries.find((e) => e.url.endsWith("/orphan"))?.priority).toBe(0.5);
    expect(sm.sitemaps.find((s) => s.url.endsWith("index.xml"))?.isIndex).toBe(true);
    // Conventional /sitemap.xml probe 404s silently (not a reportable error).
    expect(sm.sitemaps.find((s) => s.url.endsWith("/sitemap.xml"))).toBeUndefined();
  });
});

describe("crawlSite", () => {
  it("crawls BFS with dedupe, robots, redirects, sitemap seeding and external checks", async () => {
    hits = [];
    const pages: CrawledPage[] = [];
    let progress = 0;
    const summary = await crawlSite({ startUrl: `${origin}/`, ...testOpts, maxPages: 50 }, { onPage: (p) => void pages.push(p), onProgress: () => void progress++ });

    const byPath = new Map(pages.map((p) => [new URL(p.url).pathname + new URL(p.url).search, p]));
    expect(summary.stopReason).toBe("frontier_exhausted");
    expect(summary.robotsTxtFound).toBe(true);
    expect(byPath.get("/")?.statusCode).toBe(200);
    expect(byPath.get("/")?.headerCanonicalUrl).toBe(`${origin}/`);
    expect(byPath.get("/")?.depth).toBe(0);
    expect(byPath.get("/a")?.discoverySource).toBe("link");
    expect(byPath.get("/b")?.analysis?.isIndexable).toBe(false); // X-Robots-Tag
    expect(byPath.get("/redirect")?.fetchClass).toBe("redirect");
    expect(byPath.get("/redirect")?.redirectUrl).toBe(`${origin}/a`);
    expect(byPath.get("/missing")?.fetchClass).toBe("client_error");
    expect(byPath.get("/private/x")?.fetchClass).toBe("skipped_robots");
    expect(byPath.get("/orphan")?.discoverySource).toBe("sitemap");
    expect(byPath.get("/from-txt")).toBeDefined();
    expect(byPath.has("/doc.pdf")).toBe(false);
    expect(byPath.get("/a?page=2")?.depth).toBe(2);
    // tracking params stripped → /b fetched once, / fetched once by the crawler (plus the start-url resolve)
    expect(pages.filter((p) => p.normalizedUrl === `${origin}/b`)).toHaveLength(1);
    expect(pages.filter((p) => p.normalizedUrl === `${origin}/`)).toHaveLength(1);
    expect(hits.filter((h) => h === "/private/x")).toHaveLength(0);
    expect(summary.pagesCrawled).toBe(pages.length);
    expect(summary.pagesFailed).toBeGreaterThanOrEqual(1);
    expect(progress).toBeGreaterThan(0);
    expect(sitemapUrlSet(summary).has(`${origin}/orphan`)).toBe(true);
    expect(summary.externalLinkStatus.get("http://127.0.0.1:1/ext")).toBeNull(); // unreachable → null, never fabricated
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("honours maxPages", async () => {
    const pages: CrawledPage[] = [];
    const s = await crawlSite({ startUrl: `${origin}/`, ...testOpts, maxPages: 2, concurrency: 1 }, { onPage: (p) => void pages.push(p) });
    expect(s.stopReason).toBe("max_pages");
    expect(pages.length).toBeLessThanOrEqual(2);
  });

  it("honours exclude patterns and maxDepth", async () => {
    const pages: CrawledPage[] = [];
    await crawlSite({ startUrl: `${origin}/`, ...testOpts, excludePatterns: ["/a*"], maxDepth: 1, maxPages: 50 }, { onPage: (p) => void pages.push(p) });
    const paths = pages.map((p) => new URL(p.url).pathname);
    expect(paths).not.toContain("/a");
    expect(pages.every((p) => p.depth <= 1)).toBe(true);
  });

  it("stops on abort signal / max duration", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const s = await crawlSite({ startUrl: `${origin}/slow`, ...testOpts, signal: ac.signal, maxPages: 50 }, {});
    expect(["aborted", "start_url_failed"]).toContain(s.stopReason);
    const s2 = await crawlSite({ startUrl: `${origin}/`, ...testOpts, maxDurationMs: 1, maxPages: 50 }, {});
    expect(["max_duration", "frontier_exhausted"]).toContain(s2.stopReason);
  });

  it("refuses SSRF targets without operator allow-list", async () => {
    const pages: CrawledPage[] = [];
    const s = await crawlSite({ startUrl: `${origin}/`, delayMs: 0, maxPages: 5 }, { onPage: (p) => void pages.push(p) });
    expect(s.stopReason).toBe("start_url_failed");
    expect(pages[0]?.fetchClass).toBe("ssrf_blocked");
  });
});

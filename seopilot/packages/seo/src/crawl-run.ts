/**
 * Crawl run orchestration: persist pages/links as they are crawled (each page
 * in its own short transaction so progress is visible and memory stays flat),
 * then run the audit engine over the collected pages and store findings +
 * scores. Plan limits on crawl pages are enforced BEFORE the crawl starts and
 * usage is recorded per page actually fetched.
 */
import { crawlToAuditInput, runAudit, type AuditResult } from "@seopilot/audit";
import { crawlSite, DEFAULT_CRAWL_OPTIONS, type CrawledPage, type CrawlOptions, type CrawlSummary } from "@seopilot/crawler";
import { and, eq, inArray, schema, sql, withSystem, type Transaction } from "@seopilot/db";
import { AppError } from "@seopilot/shared";
import { assertMonthlyLimit, recordUsage } from "@seopilot/usage";

export interface StartCrawlInput {
  projectId: string;
  organizationId: string;
  jobId?: string | null;
  triggeredBy?: string;
  /** Per-run overrides. `allowHosts`/`allowPorts` are only honoured when CRAWLER_ALLOW_PRIVATE_TARGETS=true (self-hosted intranet audits). */
  overrides?: Partial<Pick<CrawlOptions, "maxPages" | "maxDepth" | "renderJavaScript" | "includePatterns" | "excludePatterns" | "allowHosts" | "allowPorts">>;
}

export async function createCrawlRun(tx: Transaction, input: StartCrawlInput) {
  const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, input.projectId)).limit(1);
  if (!project) throw new AppError("NOT_FOUND", "Project not found");
  const { allowHosts, allowPorts, ...rest } = input.overrides ?? {};
  const privateOk = process.env.CRAWLER_ALLOW_PRIVATE_TARGETS === "true";
  const cfg = { ...project.crawlConfig, ...rest, ...(privateOk && allowHosts ? { allowHosts, allowPorts } : {}) };
  const { remaining } = await assertMonthlyLimit(tx, input.organizationId, "crawl_pages", 1);
  const maxPages = Math.max(1, Math.min(cfg.maxPages, remaining + 1));
  const [run] = await tx
    .insert(schema.crawlRuns)
    .values({ projectId: project.id, organizationId: input.organizationId, jobId: input.jobId ?? null, status: "queued", startUrl: project.siteUrl, config: { ...cfg, maxPages }, triggeredBy: input.triggeredBy ?? "manual" })
    .returning();
  return { run: run!, project, options: { ...cfg, maxPages } };
}

function pageRow(runId: string, projectId: string, organizationId: string, p: CrawledPage, inSitemap: boolean): typeof schema.crawlPages.$inferInsert {
  const a = p.analysis;
  return {
    crawlRunId: runId, projectId, organizationId,
    url: p.url, normalizedUrl: p.normalizedUrl, depth: p.depth, discoveredFrom: p.discoveredFrom, discoverySource: p.discoverySource,
    statusCode: p.statusCode, fetchClass: p.fetchClass, contentType: p.contentType, isHtml: p.isHtml, redirectUrl: p.redirectUrl, redirectChain: p.redirectChain,
    responseTimeMs: p.responseTimeMs, ttfbMs: p.ttfbMs, byteLength: p.byteLength, contentEncoding: p.contentEncoding, isHttps: p.isHttps,
    title: a?.title ?? null, metaDescription: a?.metaDescription ?? null, canonicalUrl: a?.canonicalUrl ?? null, headerCanonicalUrl: p.headerCanonicalUrl, robotsMeta: a?.robotsMeta ?? null, xRobotsTag: p.xRobotsTag,
    responseHeaders: p.responseHeaders, isIndexable: a?.isIndexable ?? false, isNofollow: a?.isNofollow ?? false, h1: a?.h1s ?? [], headingOutline: a?.headingOutline ?? [], wordCount: a?.wordCount ?? 0, contentHash: a?.contentHash ?? null,
    lang: a?.lang ?? null, hreflang: a?.hreflang ?? [], ogTitle: a?.ogTitle ?? null, ogDescription: a?.ogDescription ?? null, ogImage: a?.ogImage ?? null,
    imageCount: a?.imageCount ?? 0, imagesMissingAlt: a?.imagesMissingAlt ?? 0, images: (a?.images ?? []).slice(0, 200), internalLinkCount: a?.internalLinkCount ?? 0, externalLinkCount: a?.externalLinkCount ?? 0,
    structuredData: a?.structuredData ?? [], mixedContent: a?.mixedContent ?? [], paginationRel: a?.paginationRel ?? null, inSitemap, viewportMeta: a?.viewportMeta ?? false, renderedWithJs: p.renderedWithJs, errorMessage: p.errorMessage,
  } as typeof schema.crawlPages.$inferInsert;
}

export interface ExecuteCrawlResult {
  runId: string;
  summary: CrawlSummary;
  audit: AuditResult | null;
  pagesStored: number;
}

/**
 * Executes a crawl for an existing run. Uses system-context transactions
 * scoped to the organization (worker has no user session). `signal` aborts.
 */
export async function executeCrawlRun(input: { runId: string; organizationId: string; projectId: string; options: Partial<CrawlOptions> & { startUrl: string }; signal?: AbortSignal; onProgress?: (crawled: number) => void }): Promise<ExecuteCrawlResult> {
  const { runId, organizationId, projectId } = input;
  await withSystem(organizationId, (tx) => tx.update(schema.crawlRuns).set({ status: "running", startedAt: new Date(), updatedAt: new Date() }).where(eq(schema.crawlRuns.id, runId)));
  const pages: CrawledPage[] = [];
  let stored = 0;
  let lastProgressWrite = 0;
  const summary = await crawlSite({ ...DEFAULT_CRAWL_OPTIONS, ...input.options, signal: input.signal }, {
    onPage: async (p) => {
      pages.push(p);
      await withSystem(organizationId, async (tx) => {
        await tx.insert(schema.crawlPages).values(pageRow(runId, projectId, organizationId, p, false)).onConflictDoNothing();
        await recordUsage(tx, { organizationId, projectId, metric: "crawl_pages", quantity: 1 });
      });
      stored++;
      if (Date.now() - lastProgressWrite > 2000) {
        lastProgressWrite = Date.now();
        await withSystem(organizationId, (tx) => tx.update(schema.crawlRuns).set({ pagesCrawled: stored, updatedAt: new Date() }).where(eq(schema.crawlRuns.id, runId)));
        input.onProgress?.(stored);
      }
    },
  });

  // Sitemap membership + links (bulk, after crawl)
  const sitemapSet = new Set(summary.sitemapEntries.map((e) => e.normalizedUrl));
  await withSystem(organizationId, async (tx) => {
    const inSitemap = pages.filter((p) => sitemapSet.has(p.normalizedUrl)).map((p) => p.normalizedUrl);
    for (let i = 0; i < inSitemap.length; i += 1000) await tx.update(schema.crawlPages).set({ inSitemap: true }).where(and(eq(schema.crawlPages.crawlRunId, runId), inArray(schema.crawlPages.normalizedUrl, inSitemap.slice(i, i + 1000))));
    const idRows = await tx.select({ id: schema.crawlPages.id, normalizedUrl: schema.crawlPages.normalizedUrl }).from(schema.crawlPages).where(eq(schema.crawlPages.crawlRunId, runId));
    const idByUrl = new Map(idRows.map((r) => [r.normalizedUrl, r.id]));
    const statusByUrl = new Map(pages.map((p) => [p.normalizedUrl, p.statusCode]));
    const linkRows: Array<typeof schema.crawlLinks.$inferInsert> = [];
    for (const p of pages) {
      const sourcePageId = idByUrl.get(p.normalizedUrl);
      if (!sourcePageId || !p.analysis) continue;
      for (const l of p.analysis.links.slice(0, 2000)) {
        linkRows.push({ crawlRunId: runId, projectId, organizationId, sourcePageId, sourceUrl: p.url, targetUrl: l.href, targetNormalizedUrl: l.normalized, anchorText: l.anchor, isInternal: l.isInternal, isNofollow: l.isNofollow, rel: l.rel, targetStatusCode: l.isInternal ? (statusByUrl.get(l.normalized) ?? null) : (summary.externalLinkStatus.get(l.normalized) ?? null) });
      }
    }
    for (let i = 0; i < linkRows.length; i += 500) await tx.insert(schema.crawlLinks).values(linkRows.slice(i, i + 500));
    // inbound counts
    await tx.execute(sql`UPDATE crawl_pages cp SET inbound_link_count = s.n FROM (SELECT target_normalized_url u, COUNT(DISTINCT source_page_id)::int n FROM crawl_links WHERE crawl_run_id = ${runId} AND is_internal GROUP BY 1) s WHERE cp.crawl_run_id = ${runId} AND cp.normalized_url = s.u`);
  });

  if (summary.stopReason === "start_url_failed" || summary.stopReason === "aborted") {
    await withSystem(organizationId, (tx) => tx.update(schema.crawlRuns).set({ status: summary.stopReason === "aborted" ? "cancelled" : "failed", pagesCrawled: stored, pagesDiscovered: summary.pagesDiscovered, pagesFailed: summary.pagesFailed, stopReason: summary.stopReason, errorMessage: summary.stopReason === "start_url_failed" ? "Start URL could not be fetched" : null, robotsTxtFound: summary.robotsTxtFound, robotsTxt: summary.robotsTxt, sitemapUrls: summary.sitemapUrls, sitemapUrlCount: summary.sitemapEntries.length, finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.crawlRuns.id, runId)));
    return { runId, summary, audit: null, pagesStored: stored };
  }

  const audit = runAudit(crawlToAuditInput(summary, pages));
  await withSystem(organizationId, async (tx) => {
    const idRows = await tx.select({ id: schema.crawlPages.id, url: schema.crawlPages.url }).from(schema.crawlPages).where(eq(schema.crawlPages.crawlRunId, runId));
    const idByUrl = new Map(idRows.map((r) => [r.url, r.id]));
    // first-seen tracking: same rule+dedupeKey open in previous completed run of this project
    const [prev] = await tx.select({ id: schema.crawlRuns.id }).from(schema.crawlRuns).where(and(eq(schema.crawlRuns.projectId, projectId), eq(schema.crawlRuns.status, "completed"))).orderBy(sql`${schema.crawlRuns.finishedAt} DESC`).limit(1);
    const prevFirstSeen = new Map<string, string>();
    if (prev) {
      const prevRows = await tx.select({ ruleId: schema.auditFindings.ruleId, dedupeKey: schema.auditFindings.dedupeKey, firstSeenRunId: schema.auditFindings.firstSeenRunId }).from(schema.auditFindings).where(eq(schema.auditFindings.crawlRunId, prev.id));
      for (const r of prevRows) prevFirstSeen.set(`${r.ruleId}\u0000${r.dedupeKey}`, r.firstSeenRunId ?? prev.id);
    }
    const rows = audit.findings.map((f) => ({ crawlRunId: runId, projectId, organizationId, ruleId: f.ruleId, severity: f.severity, category: f.category, pageId: f.pageUrl ? (idByUrl.get(f.pageUrl) ?? null) : null, pageUrl: f.pageUrl, dedupeKey: f.dedupeKey, evidence: f.evidence, status: "open" as const, firstSeenRunId: prevFirstSeen.get(`${f.ruleId}\u0000${f.dedupeKey}`) ?? runId }));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(schema.auditFindings).values(rows.slice(i, i + 500)).onConflictDoNothing();
    await tx.update(schema.crawlRuns).set({ status: "completed", pagesCrawled: stored, pagesDiscovered: summary.pagesDiscovered, pagesFailed: summary.pagesFailed, stopReason: summary.stopReason, robotsTxtFound: summary.robotsTxtFound, robotsTxt: summary.robotsTxt, sitemapUrls: summary.sitemapUrls, sitemapUrlCount: summary.sitemapEntries.length, scoreOverall: audit.scoreOverall, scoreBreakdown: audit.scoreBreakdown, issueCounts: audit.issueCounts, finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.crawlRuns.id, runId));
  });
  return { runId, summary, audit, pagesStored: stored };
}

export async function failCrawlRun(organizationId: string, runId: string, error: string): Promise<void> {
  await withSystem(organizationId, (tx) => tx.update(schema.crawlRuns).set({ status: "failed", errorMessage: error.slice(0, 1000), finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.crawlRuns.id, runId)));
}

/** Compare two completed runs: new / fixed / persisting findings by (rule, dedupeKey). */
export async function diffCrawlRuns(tx: Transaction, currentRunId: string, previousRunId: string) {
  const load = async (runId: string) => new Map((await tx.select({ ruleId: schema.auditFindings.ruleId, dedupeKey: schema.auditFindings.dedupeKey, severity: schema.auditFindings.severity, pageUrl: schema.auditFindings.pageUrl }).from(schema.auditFindings).where(eq(schema.auditFindings.crawlRunId, runId))).map((f) => [`${f.ruleId}\u0000${f.dedupeKey}`, f]));
  const cur = await load(currentRunId), prev = await load(previousRunId);
  const added = [...cur].filter(([k]) => !prev.has(k)).map(([, f]) => f);
  const fixed = [...prev].filter(([k]) => !cur.has(k)).map(([, f]) => f);
  return { added, fixed, persisting: cur.size - added.length };
}

import { DOCS, defineRule, hostOf, isIndexableOk } from "./_helpers";
import type { RuleDefinition } from "../types";

export const MAX_LINKS_PER_PAGE = 300;
export const DEEP_CLICK_DEPTH = 4;
const GENERIC_ANCHORS = new Set(["click here", "here", "read more", "more", "link", "this", "learn more", "continue", "next", "details"]);

export const linkRules: RuleDefinition[] = [
  defineRule({
    id: "links.internal.broken",
    category: "links", severity: "high", weight: 3, scope: "page",
    title: "Broken internal link",
    description: "The page links to an internal URL that returns 4xx/5xx. Users hit dead ends and PageRank is wasted.",
    recommendation: "Update the link to the correct URL or remove it. Where the target moved, add a 301.",
    documentationUrl: DOCS.google("crawling-indexing/http-network-errors"),
    appliesTo: (p) => p.isHtml && p.statusCode === 200,
    checkPage: (p, ctx) => {
      const broken = p.links.filter((l) => l.isInternal).map((l) => ({ l, s: ctx.statusOf(l.targetNormalizedUrl) })).filter((x) => typeof x.s === "number" && x.s >= 400);
      return broken.map((b) => ({ pageUrl: p.url, dedupeKey: `${p.normalizedUrl}→${b.l.targetNormalizedUrl}`, evidence: { target: b.l.targetNormalizedUrl, targetStatus: b.s, anchor: b.l.anchor } }));
    },
  }),
  defineRule({
    id: "links.external.broken",
    category: "links", severity: "low", weight: 1, scope: "page",
    title: "Broken external link",
    description: "The page links to an external URL that returned 4xx/5xx when checked. Dead outbound links hurt user trust and page quality signals.",
    recommendation: "Replace the link with a live source (check the Wayback Machine for an equivalent) or remove it.",
    documentationUrl: DOCS.google("fundamentals/seo-starter-guide"),
    appliesTo: (p) => p.isHtml && p.statusCode === 200,
    checkPage: (p, ctx) => {
      const broken = p.links.filter((l) => !l.isInternal).map((l) => ({ l, s: ctx.externalLinkStatus.get(l.targetNormalizedUrl) })).filter((x) => typeof x.s === "number" && x.s >= 400 && x.s !== 403 && x.s !== 429 && x.s !== 405 && x.s !== 999);
      return broken.map((b) => ({ pageUrl: p.url, dedupeKey: `${p.normalizedUrl}→${b.l.targetNormalizedUrl}`, evidence: { target: b.l.targetNormalizedUrl, targetStatus: b.s, anchor: b.l.anchor } }));
    },
  }),
  defineRule({
    id: "links.internal.to_redirect",
    category: "links", severity: "low", weight: 1, scope: "page",
    title: "Internal link points to a redirect",
    description: "Linking to URLs that redirect adds latency for users and an extra hop for crawlers on every visit.",
    recommendation: "Update internal links to point directly at the final destination URL.",
    documentationUrl: DOCS.google("crawling-indexing/301-redirects"),
    appliesTo: (p) => p.isHtml && p.statusCode === 200,
    checkPage: (p, ctx) => {
      const redirecting = p.links.filter((l) => l.isInternal && ctx.byUrl.get(l.targetNormalizedUrl)?.redirectUrl);
      return redirecting.slice(0, 50).map((l) => ({ pageUrl: p.url, dedupeKey: `${p.normalizedUrl}→${l.targetNormalizedUrl}`, evidence: { target: l.targetNormalizedUrl, finalUrl: ctx.byUrl.get(l.targetNormalizedUrl)?.redirectUrl } }));
    },
  }),
  defineRule({
    id: "links.internal.nofollow",
    category: "links", severity: "low", weight: 1, scope: "page",
    title: "Internal link uses rel=nofollow",
    description: "Nofollow on internal links throws away PageRank you already own; it does not conserve it.",
    recommendation: "Remove rel=nofollow from internal links. To keep a page out of the index, use noindex on that page.",
    documentationUrl: DOCS.google("crawling-indexing/qualify-outbound-links"),
    appliesTo: (p) => p.isHtml && p.statusCode === 200,
    checkPage: (p) => {
      const nf = p.links.filter((l) => l.isInternal && l.isNofollow);
      return nf.length ? { pageUrl: p.url, evidence: { count: nf.length, targets: nf.slice(0, 10).map((l) => l.targetNormalizedUrl) } } : null;
    },
  }),
  defineRule({
    id: "links.page.orphan",
    category: "links", severity: "medium", weight: 2, scope: "page",
    title: "Page has no internal inbound links",
    description: "No crawled page links to this URL (it was found via sitemap, canonical or hreflang only). Search engines treat unlinked pages as low priority.",
    recommendation: "Link to the page from navigation, hubs or contextually related pages.",
    documentationUrl: DOCS.google("fundamentals/seo-starter-guide"),
    checkPage: (p, ctx) => (p.depth > 0 && (ctx.inbound.get(p.normalizedUrl) ?? 0) === 0 ? { pageUrl: p.url, evidence: { discoverySource: p.discoverySource } } : null),
  }),
  defineRule({
    id: "links.page.only_nofollow_inbound",
    category: "links", severity: "low", weight: 1, scope: "page",
    title: "Page only reachable through nofollow links",
    description: "All internal links to this page are nofollow, so it receives no internal PageRank.",
    recommendation: "Add at least one followed internal link from a relevant page.",
    documentationUrl: DOCS.google("crawling-indexing/qualify-outbound-links"),
    checkPage: (p, ctx) => (ctx.inboundNofollowOnly.has(p.normalizedUrl) ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "links.page.deep",
    category: "links", severity: "low", weight: 1, scope: "page",
    title: `Page is more than ${DEEP_CLICK_DEPTH} clicks from the homepage`,
    description: "Click depth is a strong proxy for importance. Deep pages are crawled less often and rank worse.",
    recommendation: "Flatten the architecture: add hub pages, related links, pagination shortcuts or breadcrumb links so important pages sit within 3 clicks.",
    documentationUrl: DOCS.google("fundamentals/seo-starter-guide"),
    checkPage: (p) => (p.depth > DEEP_CLICK_DEPTH && p.discoverySource === "link" ? { pageUrl: p.url, evidence: { depth: p.depth } } : null),
  }),
  defineRule({
    id: "links.page.too_many",
    category: "links", severity: "notice", weight: 1, scope: "page",
    title: `More than ${MAX_LINKS_PER_PAGE} links on the page`,
    description: "Very large link counts dilute the value passed per link and often indicate mega-menus or tag clouds that crawlers must process on every page.",
    recommendation: "Reduce boilerplate links; keep navigation focused and move exhaustive lists to dedicated index pages.",
    documentationUrl: DOCS.google("fundamentals/seo-starter-guide"),
    checkPage: (p) => (p.internalLinkCount + p.externalLinkCount > MAX_LINKS_PER_PAGE ? { pageUrl: p.url, evidence: { internal: p.internalLinkCount, external: p.externalLinkCount } } : null),
  }),
  defineRule({
    id: "links.anchor.generic",
    category: "links", severity: "notice", weight: 1, scope: "page",
    title: "Generic anchor text on internal links",
    description: "Anchors like 'click here' or 'read more' give search engines no information about the target page.",
    recommendation: "Use descriptive anchor text that names the topic of the destination page.",
    documentationUrl: DOCS.google("fundamentals/seo-starter-guide"),
    checkPage: (p) => {
      const generic = p.links.filter((l) => l.isInternal && l.anchor && GENERIC_ANCHORS.has(l.anchor.trim().toLowerCase()));
      return generic.length >= 3 ? { pageUrl: p.url, evidence: { count: generic.length, examples: generic.slice(0, 5).map((l) => ({ anchor: l.anchor, target: l.targetNormalizedUrl })) } } : null;
    },
  }),
  defineRule({
    id: "links.external.http_on_https_site",
    category: "links", severity: "notice", weight: 1, scope: "page",
    title: "Internal link uses http:// on an https site",
    description: "Links to the http:// version of your own site force a redirect on every click and can leak referrer data.",
    recommendation: "Update internal links to https:// (search the templates and database for the old scheme).",
    documentationUrl: DOCS.google("crawling-indexing/https-best-practices"),
    appliesTo: (p, ctx) => isIndexableOk(p) && ctx.site.finalStartUrl.startsWith("https://"),
    checkPage: (p, ctx) => {
      const siteHost = hostOf(ctx.site.finalStartUrl);
      const bad = p.links.filter((l) => l.targetNormalizedUrl.startsWith("http://") && hostOf(l.targetNormalizedUrl) === siteHost);
      return bad.length ? { pageUrl: p.url, evidence: { count: bad.length, examples: bad.slice(0, 5).map((l) => l.targetNormalizedUrl) } } : null;
    },
  }),
];

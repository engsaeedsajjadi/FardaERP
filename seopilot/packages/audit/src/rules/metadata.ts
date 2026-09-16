import { DOCS, defineRule, duplicates, trunc } from "./_helpers";
import type { AuditContext, AuditPage, RuleDefinition } from "../types";

export const TITLE_MIN = 30, TITLE_MAX = 60, DESC_MIN = 70, DESC_MAX = 160;

export const metadataRules: RuleDefinition[] = [
  defineRule({
    id: "metadata.title.missing",
    category: "metadata", severity: "high", weight: 3, scope: "page",
    title: "Missing <title>",
    description: "The title is the strongest on-page relevance signal and the headline of the search result. Without it Google generates one from page content or anchors.",
    recommendation: "Add a unique, descriptive <title> of roughly 30–60 characters that includes the primary topic and, optionally, the brand.",
    documentationUrl: DOCS.google("appearance/title-link"),
    checkPage: (p) => (!p.title ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "metadata.title.too_long",
    category: "metadata", severity: "low", weight: 1, scope: "page",
    title: "Title longer than 60 characters",
    description: "Long titles are truncated in search results and Google is more likely to rewrite them.",
    recommendation: `Trim to about ${TITLE_MAX} characters, front-loading the most important words.`,
    documentationUrl: DOCS.google("appearance/title-link"),
    checkPage: (p) => (p.title && p.title.length > TITLE_MAX ? { pageUrl: p.url, evidence: { title: trunc(p.title), length: p.title.length } } : null),
  }),
  defineRule({
    id: "metadata.title.too_short",
    category: "metadata", severity: "low", weight: 1, scope: "page",
    title: "Title shorter than 30 characters",
    description: "Very short titles rarely describe the page well enough to earn clicks or cover secondary terms.",
    recommendation: `Expand the title to ${TITLE_MIN}–${TITLE_MAX} characters with a specific description of the page.`,
    documentationUrl: DOCS.google("appearance/title-link"),
    checkPage: (p) => (p.title && p.title.length < TITLE_MIN ? { pageUrl: p.url, evidence: { title: p.title, length: p.title.length } } : null),
  }),
  defineRule({
    id: "metadata.title.duplicate",
    category: "metadata", severity: "medium", weight: 2, scope: "page",
    title: "Duplicate title across pages",
    description: "Several indexable pages share the same title, which makes it hard for search engines (and users) to tell them apart and hints at duplicate content.",
    recommendation: "Write a unique title for each page that reflects its specific content.",
    documentationUrl: DOCS.google("appearance/title-link"),
    checkPage: (p, ctx) => {
      const dupes = titleGroup(ctx, p);
      return dupes ? { pageUrl: p.url, evidence: { title: trunc(p.title), sharedWith: dupes.filter((d) => d.normalizedUrl !== p.normalizedUrl).slice(0, 10).map((d) => d.url), count: dupes.length } } : null;
    },
  }),
  defineRule({
    id: "metadata.title.same_as_h1",
    category: "metadata", severity: "notice", weight: 1, scope: "page",
    title: "Title identical to H1",
    description: "Informational: using the exact same text for title and H1 wastes an opportunity to target a secondary phrasing.",
    recommendation: "Keep them aligned in topic but vary the wording (e.g. add a benefit or qualifier to the title).",
    documentationUrl: DOCS.google("appearance/title-link"),
    checkPage: (p) => (p.title && p.h1s[0] && p.title.trim().toLowerCase() === p.h1s[0].trim().toLowerCase() ? { pageUrl: p.url, evidence: { title: trunc(p.title) } } : null),
  }),
  defineRule({
    id: "metadata.description.missing",
    category: "metadata", severity: "medium", weight: 2, scope: "page",
    title: "Missing meta description",
    description: "Meta descriptions are not a ranking factor, but they are the default snippet and directly affect click-through rate.",
    recommendation: `Write a compelling ${DESC_MIN}–${DESC_MAX} character summary with a call to action and the main keyword.`,
    documentationUrl: DOCS.google("appearance/snippet"),
    checkPage: (p) => (!p.metaDescription ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "metadata.description.too_long",
    category: "metadata", severity: "notice", weight: 1, scope: "page",
    title: "Meta description longer than 160 characters",
    description: "Long descriptions are truncated with an ellipsis in most results.",
    recommendation: `Trim to about ${DESC_MAX} characters.`,
    documentationUrl: DOCS.google("appearance/snippet"),
    checkPage: (p) => (p.metaDescription && p.metaDescription.length > DESC_MAX ? { pageUrl: p.url, evidence: { length: p.metaDescription.length, description: trunc(p.metaDescription) } } : null),
  }),
  defineRule({
    id: "metadata.description.too_short",
    category: "metadata", severity: "notice", weight: 1, scope: "page",
    title: "Meta description shorter than 70 characters",
    description: "Very short descriptions leave snippet space unused and are often replaced by Google.",
    recommendation: `Expand to ${DESC_MIN}–${DESC_MAX} characters.`,
    documentationUrl: DOCS.google("appearance/snippet"),
    checkPage: (p) => (p.metaDescription && p.metaDescription.length < DESC_MIN ? { pageUrl: p.url, evidence: { length: p.metaDescription.length, description: p.metaDescription } } : null),
  }),
  defineRule({
    id: "metadata.description.duplicate",
    category: "metadata", severity: "low", weight: 1, scope: "page",
    title: "Duplicate meta description across pages",
    description: "Identical descriptions on different pages usually mean a template default is being used, producing undifferentiated snippets.",
    recommendation: "Write page-specific descriptions or omit the tag so Google builds a snippet from content.",
    documentationUrl: DOCS.google("appearance/snippet"),
    checkPage: (p, ctx) => {
      const dupes = descGroup(ctx, p);
      return dupes ? { pageUrl: p.url, evidence: { description: trunc(p.metaDescription), count: dupes.length } } : null;
    },
  }),
  defineRule({
    id: "metadata.opengraph.missing",
    category: "metadata", severity: "low", weight: 1, scope: "page",
    title: "Missing Open Graph tags",
    description: "Without og:title / og:description / og:image, links shared on social networks and chat apps render without a preview.",
    recommendation: "Add og:title, og:description and a 1200×630 og:image to every shareable page.",
    documentationUrl: "https://ogp.me/",
    checkPage: (p) => {
      const missing = [!p.ogTitle && "og:title", !p.ogDescription && "og:description", !p.ogImage && "og:image"].filter(Boolean);
      return missing.length ? { pageUrl: p.url, evidence: { missing } } : null;
    },
  }),
  defineRule({
    id: "metadata.lang.missing",
    category: "metadata", severity: "low", weight: 1, scope: "page",
    title: "Missing <html lang> attribute",
    description: "The lang attribute helps screen readers, translation tools and search engines identify the page language.",
    recommendation: "Set <html lang=\"xx\"> to the page's primary language using a BCP-47 code.",
    documentationUrl: DOCS.mdn("HTML/Global_attributes/lang"),
    checkPage: (p) => (!p.lang ? { pageUrl: p.url, evidence: {} } : null),
  }),
];

// Per-context memoised duplicate groups keyed by page URL (rules stay pure; the context object identity keys the cache).
type Group = AuditPage[];
const titleCache = new WeakMap<object, Map<string, Group>>();
const descCache = new WeakMap<object, Map<string, Group>>();

function groupsByPage(ctx: AuditContext, cache: WeakMap<object, Map<string, Group>>, key: (p: AuditPage) => string | null): Map<string, Group> {
  let g = cache.get(ctx);
  if (!g) {
    g = new Map();
    const canonicalPages = ctx.indexablePages.filter((p) => !p.canonicalUrl || p.canonicalUrl === p.normalizedUrl);
    for (const group of duplicates(canonicalPages, key).values()) for (const p of group) g.set(p.normalizedUrl, group);
    cache.set(ctx, g);
  }
  return g;
}
const titleGroup = (ctx: AuditContext, p: AuditPage) => groupsByPage(ctx, titleCache, (x) => (x.title ? x.title.trim().toLowerCase() : null)).get(p.normalizedUrl);
const descGroup = (ctx: AuditContext, p: AuditPage) => groupsByPage(ctx, descCache, (x) => (x.metaDescription ? x.metaDescription.trim().toLowerCase() : null)).get(p.normalizedUrl);

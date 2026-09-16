import { DOCS, defineRule, duplicates, trunc } from "./_helpers";
import type { AuditContext, AuditPage, RuleDefinition } from "../types";

export const THIN_WORDS = 200;

const dupCache = new WeakMap<object, Map<string, AuditPage[]>>();
function contentGroups(ctx: AuditContext): Map<string, AuditPage[]> {
  let g = dupCache.get(ctx);
  if (!g) {
    g = duplicates(ctx.indexablePages.filter((p) => p.wordCount >= 50 && (!p.canonicalUrl || p.canonicalUrl === p.normalizedUrl)), (p) => p.contentHash);
    dupCache.set(ctx, g);
  }
  return g;
}

export const contentRules: RuleDefinition[] = [
  defineRule({
    id: "content.h1.missing",
    category: "content", severity: "medium", weight: 2, scope: "page",
    title: "Missing H1",
    description: "The H1 tells users and search engines what the page is about and anchors the heading outline.",
    recommendation: "Add exactly one H1 that describes the page's main topic.",
    documentationUrl: DOCS.google("fundamentals/seo-starter-guide"),
    checkPage: (p) => (p.h1s.length === 0 ? { pageUrl: p.url, evidence: {} } : null),
  }),
  defineRule({
    id: "content.h1.multiple",
    category: "content", severity: "low", weight: 1, scope: "page",
    title: "Multiple H1 tags",
    description: "Several H1s dilute the main topic signal and usually indicate template misuse (logo, navigation or widgets marked up as H1).",
    recommendation: "Keep one H1 for the page title and demote the others to H2/H3 or plain styled text.",
    documentationUrl: DOCS.google("fundamentals/seo-starter-guide"),
    checkPage: (p) => (p.h1s.length > 1 ? { pageUrl: p.url, evidence: { count: p.h1s.length, h1s: p.h1s.slice(0, 5).map((h) => trunc(h, 100)) } } : null),
  }),
  defineRule({
    id: "content.headings.skipped_level",
    category: "content", severity: "notice", weight: 1, scope: "page",
    title: "Heading levels skipped",
    description: "Jumping from H1 to H3 (etc.) breaks the document outline used by assistive technology and content-understanding systems.",
    recommendation: "Nest headings sequentially (H1 → H2 → H3) and use CSS for visual sizing instead of picking a level for its look.",
    documentationUrl: DOCS.mdn("HTML/Element/Heading_Elements"),
    checkPage: (p) => {
      let prev = 0;
      for (const h of p.headingOutline) {
        if (prev && h.level > prev + 1) return { pageUrl: p.url, evidence: { from: prev, to: h.level, heading: trunc(h.text, 100) } };
        prev = h.level;
      }
      return null;
    },
  }),
  defineRule({
    id: "content.thin",
    category: "content", severity: "medium", weight: 2, scope: "page",
    title: "Thin content",
    description: `Indexable pages with fewer than ${THIN_WORDS} words of body text rarely satisfy a query on their own and can drag down site-wide quality assessments.`,
    recommendation: "Expand the page with genuinely useful content, merge it into a stronger page, or noindex it if it serves a non-search purpose.",
    documentationUrl: DOCS.google("fundamentals/creating-helpful-content"),
    checkPage: (p) => (p.wordCount < THIN_WORDS ? { pageUrl: p.url, evidence: { wordCount: p.wordCount, renderedWithJs: p.renderedWithJs } } : null),
  }),
  defineRule({
    id: "content.duplicate",
    category: "content", severity: "high", weight: 3, scope: "page",
    title: "Duplicate content (identical body text)",
    description: "Two or more indexable pages have identical main content and no canonical relationship. Search engines will pick one and may ignore the rest.",
    recommendation: "Consolidate with a canonical or 301 to the preferred URL, or differentiate the content.",
    documentationUrl: DOCS.google("crawling-indexing/consolidate-duplicate-urls"),
    checkPage: (p, ctx) => {
      const g = p.contentHash ? contentGroups(ctx).get(p.contentHash) : undefined;
      return g && g.length > 1 ? { pageUrl: p.url, evidence: { duplicates: g.filter((d) => d.normalizedUrl !== p.normalizedUrl).slice(0, 10).map((d) => d.url), count: g.length } } : null;
    },
  }),
  defineRule({
    id: "content.empty_shell",
    category: "content", severity: "high", weight: 2, scope: "page",
    title: "Page has almost no HTML content (likely client-side rendered)",
    description: "The raw HTML contains fewer than 20 words. If content only appears after JavaScript runs, indexing is delayed and some crawlers will see an empty page.",
    recommendation: "Server-side render or pre-render the primary content, or enable JavaScript rendering in the crawl settings to verify what the rendered DOM contains.",
    documentationUrl: DOCS.google("crawling-indexing/javascript-seo-basics"),
    checkPage: (p) => (p.wordCount < 20 && !p.renderedWithJs ? { pageUrl: p.url, evidence: { wordCount: p.wordCount } } : null),
  }),
  defineRule({
    id: "content.lorem_or_placeholder",
    category: "content", severity: "medium", weight: 1, scope: "page",
    title: "Placeholder text detected in title or headings",
    description: "Text such as 'lorem ipsum', 'untitled' or 'coming soon' in the title/H1 indicates an unfinished page that should not be indexed.",
    recommendation: "Finish the page content or noindex it until it is ready.",
    documentationUrl: DOCS.google("fundamentals/creating-helpful-content"),
    checkPage: (p) => {
      const hay = [p.title ?? "", ...p.h1s].join(" | ").toLowerCase();
      const m = hay.match(/lorem ipsum|untitled|coming soon|under construction|test page|sample page|hello world/);
      return m ? { pageUrl: p.url, evidence: { match: m[0] } } : null;
    },
  }),
];

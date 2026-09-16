import { describe, expect, it } from "vitest";
import type { PageAnalysis } from "@seopilot/crawler";
import { analyzeAeo, buildLlmsTxt } from "./index";

const base: PageAnalysis = { title: "t", metaDescription: null, canonicalUrl: null, robotsMeta: null, isIndexable: true, isNofollow: false, h1s: ["How long does an SEO audit take?"], headingOutline: [{ level: 1, text: "How long does an SEO audit take?" }, { level: 2, text: "What does an audit include?" }, { level: 2, text: "Pricing" }], wordCount: 900, contentHash: "x", lang: "en", hreflang: [], ogTitle: null, ogDescription: null, ogImage: null, images: [], imageCount: 0, imagesMissingAlt: 0, links: [], internalLinkCount: 0, externalLinkCount: 0, structuredData: [{ format: "json-ld", type: "FAQPage", valid: true, errors: [], warnings: [] }], mixedContent: [], paginationRel: null, viewportMeta: true, textSample: "An SEO audit usually takes between three and ten working days depending on site size, crawl depth and how many templates need manual review; small sites finish faster. What does an audit include? It includes a technical crawl, on-page review, content analysis, backlink review and a prioritised action plan that your team can execute over the following quarter with clear owners. Steps:\n1. Crawl\n2. Review", resourceUrls: { scripts: [], stylesheets: [] } };

describe("analyzeAeo", () => {
  it("scores measured signals and extracts question/answer candidates", () => {
    const r = analyzeAeo(base);
    expect(r.questionHeadings).toEqual(["How long does an SEO audit take?", "What does an audit include?"]);
    expect(r.answerCandidates.length).toBe(2);
    expect(r.signals.find((s) => s.id === "aeo.faq_schema")!.passed).toBe(true);
    expect(r.signals.find((s) => s.id === "aeo.lists_or_steps")!.passed).toBe(true);
    expect(r.signals.find((s) => s.id === "aeo.howto_or_article_schema")!.passed).toBe(false);
    expect(r.score).toBeGreaterThan(50);
    expect(r.score).toBeLessThan(100);
  });
  it("gives a low score to a noindex page without questions", () => {
    const r = analyzeAeo({ ...base, isIndexable: false, h1s: ["Welcome"], headingOutline: [{ level: 1, text: "Welcome" }], structuredData: [], textSample: "Welcome to our site. We do things.", wordCount: 40 });
    expect(r.score).toBeLessThan(20);
    expect(r.signals.find((s) => s.id === "aeo.indexable")!.passed).toBe(false);
  });
  it("builds llms.txt from indexable pages only", () => {
    const txt = buildLlmsTxt({ name: "Site", domain: "s.example", description: "desc" }, [{ url: "https://s.example/", title: "Home", metaDescription: "d", isIndexable: true, depth: 0 }, { url: "https://s.example/hidden", title: "Hidden", metaDescription: null, isIndexable: false, depth: 1 }]);
    expect(txt).toContain("# Site");
    expect(txt).toContain("- [Home](https://s.example/): d");
    expect(txt).not.toContain("Hidden");
  });
});

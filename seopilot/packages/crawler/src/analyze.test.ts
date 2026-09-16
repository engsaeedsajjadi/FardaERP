import { describe, expect, it } from "vitest";
import { analyzeHtml } from "./analyze";

const html = `<!doctype html><html lang="en"><head>
<title> Hello  World </title>
<meta name="description" content="A page">
<meta name="robots" content="noindex, follow">
<meta name="viewport" content="width=device-width">
<link rel="canonical" href="/canon">
<link rel="alternate" hreflang="fr" href="https://example.com/fr/">
<link rel="next" href="/page/2">
<meta property="og:title" content="OG"><meta property="og:image" content="//cdn.example.com/i.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"H","author":{"@type":"Person","name":"A"}}</script>
<script src="http://insecure.example.com/x.js"></script>
</head><body>
<h1>Main</h1><h2>Sub</h2><h1>Second</h1>
<p>${"word ".repeat(120)}</p>
<img src="/a.png" alt="a"><img src="/b.png"><img src="/c.png" alt="">
<a href="/internal">In</a><a href="https://other.com/x" rel="nofollow">Out</a><a href="mailto:x@y.z">mail</a><a href="#top">top</a>
</body></html>`;

describe("analyzeHtml", () => {
  const a = analyzeHtml(html, "https://example.com/blog/post");
  it("extracts head signals", () => {
    expect(a.title).toBe("Hello World");
    expect(a.metaDescription).toBe("A page");
    expect(a.canonicalUrl).toBe("https://example.com/canon");
    expect(a.isIndexable).toBe(false);
    expect(a.isNofollow).toBe(false);
    expect(a.lang).toBe("en");
    expect(a.hreflang).toEqual([{ lang: "fr", href: "https://example.com/fr/" }]);
    expect(a.paginationRel?.next).toBe("https://example.com/page/2");
    expect(a.viewportMeta).toBe(true);
    expect(a.ogTitle).toBe("OG");
  });
  it("extracts headings, content, images", () => {
    expect(a.h1s).toEqual(["Main", "Second"]);
    expect(a.headingOutline[0]).toEqual({ level: 1, text: "Main" });
    expect(a.wordCount).toBeGreaterThanOrEqual(120);
    expect(a.imageCount).toBe(3);
    expect(a.imagesMissingAlt).toBe(1); // alt="" is a valid decorative image
    expect(a.contentHash).toMatch(/^[a-f0-9]{16,}$/);
  });
  it("classifies links and skips non-http", () => {
    expect(a.links.map((l) => l.normalized)).toEqual(["https://example.com/internal", "https://other.com/x"]);
    expect(a.internalLinkCount).toBe(1);
    expect(a.externalLinkCount).toBe(1);
    expect(a.links[1]?.rel).toContain("nofollow");
  });
  it("finds structured data and mixed content", () => {
    expect(a.structuredData[0]?.type).toBe("Article");
    expect(a.structuredData[0]?.format).toBe("json-ld");
    expect(a.mixedContent).toContain("http://insecure.example.com/x.js");
  });
  it("validates required schema properties", () => {
    const b = analyzeHtml(`<html><head><script type="application/ld+json">{"@type":"Product","name":"X"}</script><script type="application/ld+json">{not json</script></head><body></body></html>`, "https://e.com/");
    const product = b.structuredData.find((s) => s.type === "Product");
    expect(product?.valid).toBe(true);
    expect(product?.errors).toEqual([]);
    expect(product?.warnings.join(" ")).toMatch(/"image".*"offers"/);
    expect(b.structuredData.some((s) => s.errors.length > 0 && s.type === "unknown" && !s.valid)).toBe(true);
    const c = analyzeHtml(`<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage"}</script></head><body><div itemscope itemtype="https://schema.org/Recipe"><span itemprop="name">R</span></div></body></html>`, "https://e.com/");
    expect(c.structuredData.find((s) => s.type === "FAQPage")?.valid).toBe(false);
    expect(c.structuredData.find((s) => s.type === "Recipe")?.format).toBe("microdata");
  });
  it("is deterministic for identical bodies", () => {
    const x = analyzeHtml("<html><body><p>same</p></body></html>", "https://e.com/1");
    const y = analyzeHtml("<html><body><p>same</p></body></html>", "https://e.com/2");
    expect(x.contentHash).toBe(y.contentHash);
  });
});

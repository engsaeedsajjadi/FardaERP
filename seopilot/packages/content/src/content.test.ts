import { describe, expect, it } from "vitest";
import { checkBody, checkMeta, checkTitle, checkUnique, keywordDensity, similarity } from "./quality";
import { internalLinkSuggestions } from "./service";

describe("quality checks", () => {
  it("measures title and meta length + keyword presence", () => {
    const t = checkTitle("Best SEO Tools for Small Agencies in 2026", ["seo tools"]);
    expect(t.find((c) => c.check === "title.length")!.passed).toBe(true);
    expect(t.find((c) => c.check === "title.keyword")!.passed).toBe(true);
    expect(checkTitle("SEO", ["rank tracker"]).every((c) => c.check === "title.no_clickbait_punctuation" || !c.passed)).toBe(true);
    expect(checkMeta("x".repeat(100), []).find((c) => c.check === "meta.length")!.passed).toBe(true);
    expect(checkMeta("short", ["k"]).every((c) => !c.passed)).toBe(true);
  });
  it("computes keyword density and flags stuffing / absence", () => {
    const text = "seo tools help. " + "other words fill the page here nicely. ".repeat(20);
    expect(keywordDensity(text, "seo tools")).toBeGreaterThan(0);
    const stuffed = "seo tools seo tools seo tools seo tools";
    expect(checkBody(stuffed, ["seo tools"], 1).find((c) => c.check.startsWith("body.density"))!.passed).toBe(false);
    expect(checkBody("nothing relevant at all", ["seo tools"], 1).find((c) => c.check.startsWith("body.density"))!.passed).toBe(false);
  });
  it("detects near-duplicates by shingles", () => {
    const a = "the quick brown fox jumps over the lazy dog every single morning";
    expect(similarity(a, a)).toBe(1);
    expect(similarity(a, "completely different sentence about search engines and rankings")).toBe(0);
    expect(checkUnique(a, [a]).passed).toBe(false);
    expect(checkUnique(a, ["unrelated content"]).passed).toBe(true);
  });
});

describe("internal link suggestions", () => {
  it("suggests links only where body text covers the target's title terms and no link exists", () => {
    const pages = [
      { url: "https://s.example/a", title: "Technical SEO Audit Guide", h1s: [], textSample: "A complete technical audit covers crawling, indexing, and guide-style checklists. Read our rank tracking tools comparison for more.", links: [] as string[] },
      { url: "https://s.example/b", title: "Rank Tracking Tools Comparison", h1s: [], textSample: "We compare rank tracking tools. Nothing about audits.", links: ["https://s.example/a"] },
      { url: "https://s.example/c", title: "Pricing", h1s: [], textSample: "Plans and prices.", links: [] as string[] },
    ];
    const s = internalLinkSuggestions(pages);
    expect(s).toEqual([{ fromUrl: "https://s.example/a", toUrl: "https://s.example/b", score: expect.any(Number), matchedTerms: expect.arrayContaining(["rank", "tracking", "tools", "comparison"]) }]);
  });
});

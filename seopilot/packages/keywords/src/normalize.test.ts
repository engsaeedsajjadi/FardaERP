import { describe, expect, it } from "vitest";
import { clusterKeywords, heuristicIntent, isQuestion, normalizeKeyword, tokens } from "./normalize";

describe("keywords/normalize", () => {
  it("normalizes case, quotes, punctuation and whitespace", () => {
    expect(normalizeKeyword('  "Best" SEO   Tools!! ')).toBe("best seo tools");
    expect(normalizeKeyword("Café Crème")).toBe("café crème");
  });
  it("heuristic intent", () => {
    expect(heuristicIntent("buy running shoes")).toBe("transactional");
    expect(heuristicIntent("best running shoes 2026")).toBe("commercial");
    expect(heuristicIntent("how to tie running shoes")).toBe("informational");
    expect(heuristicIntent("acme login", ["Acme"])).toBe("navigational");
    expect(heuristicIntent("running shoes")).toBe("informational");
  });
  it("question detection", () => {
    expect(isQuestion("what is seo")).toBe(true);
    expect(isQuestion("seo tools")).toBe(false);
  });
  it("clusters by token overlap with volume-based labels and explanation", () => {
    const c = clusterKeywords([
      { keyword: "seo tools", searchVolume: 1000 },
      { keyword: "best seo tools", searchVolume: 800 },
      { keyword: "free seo tool", searchVolume: 500 },
      { keyword: "link building", searchVolume: 300 },
      { keyword: "link building services", searchVolume: 100 },
    ]);
    expect(c.map((x) => x.label)).toEqual(["seo tools", "link building"]);
    expect(c[0]?.keywords).toEqual(["seo tools", "best seo tools", "free seo tool"]);
    expect(c[0]?.meta.sharedTokens).toEqual(expect.arrayContaining(["seo", "tool"]));
    expect(c[0]?.method).toBe("token_overlap");
    expect(tokens("Running Shoes for Women")).toEqual(["run", "shoe", "women"]);
  });
});

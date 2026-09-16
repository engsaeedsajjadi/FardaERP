import { describe, expect, it } from "vitest";
import { extractUrls, measureAnswer, summarize, visibilityShare } from "./measure";

const brand = { brandName: "SEOPilot", aliases: ["SEO Pilot"], domain: "https://seopilot.example" };
const competitors = [{ domain: "rival.example", name: "Rival" }, { domain: "other.example" }];

describe("measureAnswer", () => {
  it("counts whole-word brand/alias mentions and competitor mentions", () => {
    const m = measureAnswer("SEOPilot and SEO Pilot are popular; Rival is too. seopilotter is not. rival.example has docs. Link: https://seopilot.example/x", brand, competitors);
    expect(m.brandMentionCount).toBe(2); // URL host is a citation, not a prose mention
    expect(m.brandMentioned).toBe(true);
    expect(m.competitorMentions).toEqual([{ domain: "rival.example", count: 2 }]);
  });
  it("extracts citations from text and provider lists, flagging brand-owned ones", () => {
    const m = measureAnswer("See https://docs.seopilot.example/start. Also https://rival.example/x).", brand, competitors, ["https://other.example/page"]);
    expect(m.citations.map((c) => c.domain)).toEqual(["other.example", "docs.seopilot.example", "rival.example"]);
    expect(m.brandCited).toBe(true);
    expect(extractUrls("nothing")).toEqual([]);
  });
  it("reports not-mentioned honestly", () => {
    const m = measureAnswer("Generic advice with no brands.", brand, competitors);
    expect(m).toMatchObject({ brandMentioned: false, brandMentionCount: 0, competitorMentions: [], citations: [], brandCited: false });
  });
  it("summarizes per provider and computes share (null with no answers)", () => {
    const s = summarize([
      { provider: "openai", brandMentioned: true, competitorMentions: [{ count: 1 }], citations: [1] },
      { provider: "openai", brandMentioned: false, competitorMentions: [], citations: [] },
      { provider: "perplexity", brandMentioned: true, competitorMentions: [], citations: [1, 2] },
    ]);
    expect(s).toEqual({ openai: { brandMentions: 1, competitorMentions: 1, citations: 1, answers: 2 }, perplexity: { brandMentions: 1, competitorMentions: 0, citations: 2, answers: 1 } });
    expect(visibilityShare(s)).toBe(67);
    expect(visibilityShare({})).toBeNull();
  });
});

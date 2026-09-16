import { describe, expect, it } from "vitest";
import { ctrFor, CTR_BY_POSITION } from "./service";

describe("ctr curve", () => {
  it("is monotonically decreasing and zero outside the top 20", () => {
    const vals = Object.keys(CTR_BY_POSITION).map(Number).sort((a, b) => a - b).map((p) => CTR_BY_POSITION[p] as number);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeLessThan(vals[i - 1] as number);
    expect(ctrFor(null)).toBe(0);
    expect(ctrFor(15)).toBe(0.01);
    expect(ctrFor(21)).toBe(0);
    expect(ctrFor(1)).toBe(0.274);
  });
});

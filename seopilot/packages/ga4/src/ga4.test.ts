import { describe, expect, it } from "vitest";
import { Ga4Client, ORGANIC_FILTER } from "./client";

function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

describe("Ga4Client", () => {
  it("lists properties across pages", async () => {
    const f = fakeFetch((url) => (url.includes("pageToken=") ? { body: { accountSummaries: [{ displayName: "Acct B", propertySummaries: [{ property: "properties/2", displayName: "Two" }] }] } } : { body: { accountSummaries: [{ displayName: "Acct A", propertySummaries: [{ property: "properties/1", displayName: "One" }] }], nextPageToken: "n" } }));
    const props = await new Ga4Client("t", f.fetch).listProperties();
    expect(props).toEqual([{ propertyId: "properties/1", displayName: "One", accountName: "Acct A" }, { propertyId: "properties/2", displayName: "Two", accountName: "Acct B" }]);
  });

  it("runs a report with the organic filter and parses numeric values", async () => {
    const f = fakeFetch(() => ({ body: { rowCount: 1, rows: [{ dimensionValues: [{ value: "20260901" }], metricValues: [{ value: "12" }, { value: "3.5" }] }] } }));
    const r = await new Ga4Client("t", f.fetch).runReport("properties/123", { startDate: "2026-09-01", endDate: "2026-09-01", dimensions: ["date"], metrics: ["totalUsers", "bounceRate"], dimensionFilter: ORGANIC_FILTER });
    expect(f.calls[0]!.url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/123:runReport");
    const body = JSON.parse(String(f.calls[0]!.init!.body));
    expect(body.dimensionFilter.filter.stringFilter.value).toBe("Organic Search");
    expect(body.metrics).toEqual([{ name: "totalUsers" }, { name: "bounceRate" }]);
    expect(r).toEqual({ rowCount: 1, rows: [{ dimensions: ["20260901"], metrics: [12, 3.5] }] });
  });

  it("rejects malformed property ids before calling Google", async () => {
    const f = fakeFetch(() => ({ body: {} }));
    await expect(new Ga4Client("t", f.fetch).runReport("123; drop", { startDate: "a", endDate: "b", dimensions: [], metrics: [] })).rejects.toThrow(/invalid GA4 property/);
    expect(f.calls.length).toBe(0);
  });

  it("surfaces 403 (no access to property) as PROVIDER_AUTH_FAILED", async () => {
    const f = fakeFetch(() => ({ status: 403, body: { error: { message: "User does not have sufficient permissions" } } }));
    await expect(new Ga4Client("t", f.fetch).runReport("properties/1", { startDate: "a", endDate: "b", dimensions: [], metrics: [] })).rejects.toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
  });
});

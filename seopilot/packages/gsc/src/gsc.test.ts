import { beforeAll, describe, expect, it } from "vitest";
import { resetKeyRing } from "@seopilot/security";
import { resetEnvCache } from "@seopilot/shared";
import { GscClient, propertyMatchesSite } from "./client";
import { buildAuthorizationUrl, encryptTokens, exchangeCode, getAccessToken, googleOAuthConfigured, refreshAccessToken } from "./google-oauth";

type Call = { url: string; init?: RequestInit };
function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
  resetEnvCache();
  resetKeyRing();
});

describe("google oauth", () => {
  it("reports configuration and builds an offline-consent auth URL", () => {
    expect(googleOAuthConfigured()).toBe(true);
    expect(googleOAuthConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    const u = new URL(buildAuthorizationUrl({ kind: "gsc", redirectUri: "https://app.example/cb", state: "s1" }));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toContain("webmasters.readonly");
    expect(u.searchParams.get("state")).toBe("s1");
  });

  it("exchanges a code, fetches the email and fails when no refresh token is returned", async () => {
    const ok = fakeFetch((url) => (url.includes("/token") ? { body: { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "a b" } } : { body: { email: "me@example.com" } }));
    const t = await exchangeCode({ code: "c", redirectUri: "https://app.example/cb" }, ok.fetch);
    expect(t).toMatchObject({ accessToken: "at", refreshToken: "rt", email: "me@example.com", scopes: ["a", "b"] });
    expect(ok.calls[0]!.init!.body).toContain("grant_type=authorization_code");
    const noRefresh = fakeFetch(() => ({ body: { access_token: "at", expires_in: 3600 } }));
    await expect(exchangeCode({ code: "c", redirectUri: "x" }, noRefresh.fetch)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("maps invalid_grant to PROVIDER_AUTH_FAILED", async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    await expect(refreshAccessToken("rt", f.fetch)).rejects.toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
  });

  it("getAccessToken reuses an unexpired token and refreshes + persists an expired one", async () => {
    const aad = "gsc:p1";
    const fresh = encryptTokens({ refreshToken: "rt", accessToken: "cached", expiresAt: new Date(Date.now() + 600_000) }, aad);
    const f = fakeFetch(() => ({ body: { access_token: "new-at", expires_in: 3600 } }));
    let persisted: unknown = null;
    expect(await getAccessToken(fresh, aad, async (n) => void (persisted = n), f.fetch)).toBe("cached");
    expect(f.calls.length).toBe(0);
    const stale = { ...fresh, accessTokenExpiresAt: new Date(Date.now() - 1000) };
    expect(await getAccessToken(stale, aad, async (n) => void (persisted = n), f.fetch)).toBe("new-at");
    expect(f.calls.length).toBe(1);
    expect(persisted).not.toBeNull();
    expect((persisted as { encryptedAccessToken: string }).encryptedAccessToken).not.toBe(fresh.encryptedAccessToken);
  });

  it("throws PROVIDER_NOT_CONFIGURED without client credentials", () => {
    expect(() => buildAuthorizationUrl({ kind: "ga4", redirectUri: "x", state: "s" }, {} as NodeJS.ProcessEnv)).toThrowError(/GOOGLE_CLIENT_ID/);
  });
});

describe("GscClient", () => {
  it("lists verified sites and pages searchAnalytics through 25k row windows", async () => {
    let page = 0;
    const f = fakeFetch((url, init) => {
      if (url.endsWith("/sites")) return { body: { siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }, { siteUrl: "https://x.com/", permissionLevel: "siteUnverifiedUser" }] } };
      const body = JSON.parse(String(init!.body));
      expect(body.type).toBe("web");
      page++;
      if (page === 1) return { body: { rows: Array.from({ length: 25000 }, (_, i) => ({ keys: ["2026-09-01", `q${i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 5 })) } };
      return { body: { rows: [{ keys: ["2026-09-01", "last"], clicks: 2, impressions: 4, ctr: 0.5, position: 1.5 }] } };
    });
    const c = new GscClient("tok", f.fetch);
    const sites = await c.listSites();
    expect(sites.map((s) => s.siteUrl)).toEqual(["sc-domain:example.com"]);
    const rows = await c.searchAnalyticsAll("sc-domain:example.com", { startDate: "2026-09-01", endDate: "2026-09-01", dimensions: ["date", "query"] });
    expect(rows.length).toBe(25001);
    expect(f.calls[1]!.url).toContain(encodeURIComponent("sc-domain:example.com"));
    expect(JSON.parse(String(f.calls[2]!.init!.body)).startRow).toBe(25000);
  });

  it("maps 401/403/429/5xx to typed errors", async () => {
    for (const [status, code] of [[401, "PROVIDER_AUTH_FAILED"], [403, "PROVIDER_AUTH_FAILED"], [429, "RATE_LIMITED"], [503, "UPSTREAM_UNAVAILABLE"]] as const) {
      const f = fakeFetch(() => ({ status, body: { error: { message: "boom" } } }));
      await expect(new GscClient("t", f.fetch).listSites()).rejects.toMatchObject({ code });
    }
  });

  it("parses URL inspection results", async () => {
    const f = fakeFetch(() => ({ body: { inspectionResult: { inspectionResultLink: "https://search.google.com/x", indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", googleCanonical: "https://example.com/" }, mobileUsabilityResult: { verdict: "PASS" } } } }));
    const r = await new GscClient("t", f.fetch).inspectUrl("sc-domain:example.com", "https://example.com/");
    expect(r).toMatchObject({ verdict: "PASS", coverageState: "Submitted and indexed", googleCanonical: "https://example.com/", mobileUsabilityVerdict: "PASS", richResultsVerdict: null });
  });

  it("matches properties to project sites", () => {
    expect(propertyMatchesSite("sc-domain:example.com", "https://www.example.com")).toBe(true);
    expect(propertyMatchesSite("sc-domain:example.com", "https://blog.example.com")).toBe(true);
    expect(propertyMatchesSite("sc-domain:example.com", "https://notexample.com")).toBe(false);
    expect(propertyMatchesSite("https://example.com/", "https://www.example.com")).toBe(true);
    expect(propertyMatchesSite("https://example.com/", "https://blog.example.com")).toBe(false);
  });
});

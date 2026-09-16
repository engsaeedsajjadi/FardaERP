import { describe, expect, it } from "vitest";
import { isSubdomainOf, looksLikeAsset, matchesPatterns, normalizeUrl, sameSite, urlDepth } from "./url";

describe("normalizeUrl", () => {
  it("lowercases host, strips fragment, default port and tracking params, sorts query", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/a/?b=2&a=1&utm_source=x&fbclid=y#frag")).toBe("https://example.com/a/?a=1&b=2");
  });
  it("resolves relative URLs against a base", () => {
    expect(normalizeUrl("../about", "https://example.com/blog/post/")).toBe("https://example.com/blog/about");
  });
  it("rejects non-http schemes", () => {
    expect(normalizeUrl("mailto:a@b.c")).toBeNull();
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
    expect(normalizeUrl("tel:+331")).toBeNull();
  });
  it("returns null for garbage", () => {
    expect(normalizeUrl("::::")).toBeNull();
  });
});

describe("site helpers", () => {
  it("sameSite ignores www", () => {
    expect(sameSite("https://www.example.com/a", "https://example.com/b")).toBe(true);
    expect(sameSite("https://other.com/a", "https://example.com/b")).toBe(false);
  });
  it("isSubdomainOf", () => {
    expect(isSubdomainOf("https://blog.example.com/", "https://example.com/")).toBe(true);
    expect(isSubdomainOf("https://example.com.evil.com/", "https://example.com/")).toBe(false);
  });
  it("looksLikeAsset", () => {
    expect(looksLikeAsset("https://e.com/a.pdf")).toBe(true);
    expect(looksLikeAsset("https://e.com/img/logo.PNG")).toBe(true);
    expect(looksLikeAsset("https://e.com/page.html")).toBe(false);
    expect(looksLikeAsset("https://e.com/page")).toBe(false);
  });
  it("matchesPatterns supports globs and regex", () => {
    expect(matchesPatterns("https://e.com/blog/x", ["/blog/*"])).toBe(true);
    expect(matchesPatterns("https://e.com/shop/x", ["/blog/*"])).toBe(false);
    expect(matchesPatterns("https://e.com/shop/x?page=2", ["re:[?&]page=\\d+"])).toBe(true);
    expect(matchesPatterns("https://e.com/shop/x", ["re:[?&]page=\\d+"])).toBe(false);
    expect(matchesPatterns("https://e.com/shop/x", ["*.com/shop/*"])).toBe(true);
    expect(matchesPatterns("https://e.com/shop/x", ["shop"])).toBe(true);
    expect(matchesPatterns("https://e.com/shop/x", ["re:("])).toBe(false);
  });
  it("urlDepth", () => {
    expect(urlDepth("https://e.com/")).toBe(0);
    expect(urlDepth("https://e.com/a/b/c")).toBe(3);
  });
});

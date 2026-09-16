import { describe, it, expect } from "vitest";
import { redact, redactString } from "./redact";
import { normalizeDomain, domainMatches, isValidDomain } from "./domain";
import { encodeCursor, decodeCursor } from "./pagination";

describe("redaction", () => {
  it("removes sensitive keys and token-like values", () => {
    const out = redact({ password: "hunter2", nested: { apiKey: "abc", note: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig" }, url: "https://user:pw@example.com/x", stripe: "sk_live_abcdefghijklmnop" });
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.apiKey).toBe("[REDACTED]");
    expect(out.nested.note).not.toContain("eyJ");
    expect(out.url).toBe("https://user:[REDACTED]@example.com/x");
    expect(out.stripe).toBe("[REDACTED]");
  });
  it("redacts strings inside errors", () => {
    const e = redact(new Error("failed with key sk-abcdefghijklmnopqrstuvwxyz"));
    expect(e.message).not.toContain("sk-abc");
  });
  it("leaves normal text untouched", () => {
    expect(redactString("hello world 123")).toBe("hello world 123");
  });
});

describe("domain helpers", () => {
  it("normalises", () => {
    expect(normalizeDomain("HTTPS://WWW.Example.com/path?x=1")).toBe("www.example.com");
    expect(normalizeDomain("example.com.")).toBe("example.com");
  });
  it("matches subdomains", () => {
    expect(domainMatches("blog.example.com", "example.com")).toBe(true);
    expect(domainMatches("notexample.com", "example.com")).toBe(false);
    expect(domainMatches("www.example.com", "example.com", false)).toBe(true);
  });
  it("validates", () => {
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("-bad.com")).toBe(false);
    expect(isValidDomain("localhost")).toBe(false);
  });
});

describe("cursor", () => {
  it("round-trips", () => {
    const c = encodeCursor(["2026-01-01", 5]);
    expect(decodeCursor(c)).toEqual(["2026-01-01", 5]);
    expect(decodeCursor("not-base64!")).toBeNull();
  });
});

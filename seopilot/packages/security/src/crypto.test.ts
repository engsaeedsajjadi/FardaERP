import { describe, it, expect, beforeEach } from "vitest";
import { encryptSecret, decryptSecret, needsRotation, resetKeyRing, loadKeyRing, hmacSha256 } from "./crypto";
import { hashPassword, verifyPassword, passwordPolicyIssues } from "./password";

describe("encryption at rest", () => {
  beforeEach(() => {
    resetKeyRing();
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
  });

  it("round-trips and binds AAD", () => {
    const ct = encryptSecret("ya29.token", "row-1");
    expect(ct.startsWith("v1.")).toBe(true);
    expect(ct).not.toContain("ya29");
    expect(decryptSecret(ct, "row-1")).toBe("ya29.token");
    expect(() => decryptSecret(ct, "row-2")).toThrow();
  });

  it("supports key rotation via ENCRYPTION_KEY_PREVIOUS", () => {
    const ct = encryptSecret("secret");
    resetKeyRing();
    process.env.ENCRYPTION_KEY_PREVIOUS = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    expect(decryptSecret(ct)).toBe("secret");
    expect(needsRotation(ct)).toBe(true);
    const re = encryptSecret(decryptSecret(ct));
    expect(needsRotation(re)).toBe(false);
    expect(loadKeyRing().all.size).toBe(2);
  });

  it("hmac is deterministic", () => {
    expect(hmacSha256("k", "payload")).toBe(hmacSha256("k", "payload"));
    expect(hmacSha256("k", "payload")).not.toBe(hmacSha256("k2", "payload"));
  });
});

describe("password hashing & policy", () => {
  it("hashes and verifies with scrypt", async () => {
    const h = await hashPassword("Correct-Horse-9");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Correct-Horse-9", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("enforces the policy", () => {
    expect(passwordPolicyIssues("short")).toContain("at least 10 characters");
    expect(passwordPolicyIssues("alllowercase1")).toContain("upper and lower case letters");
    expect(passwordPolicyIssues("Password12345")).toContain("not a common password");
    expect(passwordPolicyIssues("Strong-Passw0rd")).toEqual([]);
  });
});

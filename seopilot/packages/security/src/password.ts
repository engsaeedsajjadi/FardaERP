import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const N = 16384, r = 8, p = 1, KEYLEN = 64;

/** scrypt password hashing used for API-key secrets and share-link passwords (Better Auth hashes user passwords itself). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(password, salt, KEYLEN, { N, r, p })) as Buffer;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, rr, pp, saltB, keyB] = parts as [string, string, string, string, string, string];
  const key = (await scryptAsync(password, Buffer.from(saltB, "base64url"), KEYLEN, { N: Number(n), r: Number(rr), p: Number(pp) })) as Buffer;
  const expected = Buffer.from(keyB, "base64url");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Password strength policy for signup (spec §7). */
export function passwordPolicyIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 10) issues.push("at least 10 characters");
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) issues.push("upper and lower case letters");
  if (!/\d/.test(password)) issues.push("a digit");
  if (/^(password|123456|qwerty)/i.test(password)) issues.push("not a common password");
  return issues;
}

import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";

export function uuid(): string {
  return randomUUID();
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function shortId(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  return out;
}

/** Token for API keys, share links etc. Returned once; only its hash is stored. */
export function secureToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

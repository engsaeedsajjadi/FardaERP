/**
 * AES-256-GCM encryption for credentials at rest (spec §48). Key comes from
 * ENCRYPTION_KEY (base64 or hex, 32 bytes). Ciphertext format:
 *   v1.<keyId>.<iv b64url>.<tag b64url>.<ciphertext b64url>
 * A key id is embedded so keys can be rotated: set ENCRYPTION_KEY_PREVIOUS to
 * keep decrypting old rows while new writes use the current key.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, createHash } from "node:crypto";

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  const b64 = Buffer.from(trimmed, trimmed.includes("-") || trimmed.includes("_") ? "base64url" : "base64");
  if (b64.length === 32) return b64;
  // Derive a 32-byte key from arbitrary secret material (documented as acceptable for self-host).
  return createHash("sha256").update(trimmed).digest();
}

function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

interface KeyRing {
  current: { id: string; key: Buffer };
  all: Map<string, Buffer>;
}

let ring: KeyRing | null = null;

export function loadKeyRing(env: NodeJS.ProcessEnv = process.env): KeyRing {
  if (ring && env === process.env) return ring;
  const raw = env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is required");
  const current = parseKey(raw);
  const all = new Map<string, Buffer>([[keyId(current), current]]);
  if (env.ENCRYPTION_KEY_PREVIOUS) {
    for (const prev of env.ENCRYPTION_KEY_PREVIOUS.split(",")) {
      if (!prev.trim()) continue;
      const k = parseKey(prev);
      all.set(keyId(k), k);
    }
  }
  const r = { current: { id: keyId(current), key: current }, all };
  if (env === process.env) ring = r;
  return r;
}

export function resetKeyRing(): void {
  ring = null;
}

export function encryptSecret(plaintext: string, aad?: string): string {
  const { current } = loadKeyRing();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", current.id, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, aad?: string): string {
  const parts = payload.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") throw new Error("Unrecognised ciphertext format");
  const [, kid, ivB, tagB, ctB] = parts as [string, string, string, string, string];
  const { all } = loadKeyRing();
  const key = all.get(kid);
  if (!key) throw new Error("Encryption key not available for this ciphertext (rotate ENCRYPTION_KEY_PREVIOUS)");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

/** True when the ciphertext was produced with a key other than the current one (needs re-encryption). */
export function needsRotation(payload: string): boolean {
  const kid = payload.split(".")[1];
  return kid !== loadKeyRing().current.id;
}

export function hmacSha256(secret: string, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

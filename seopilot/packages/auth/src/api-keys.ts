import { and, eq, isNull, schema, withTenant, withSystem } from "@seopilot/db";
import { safeEqual, secureToken, sha256, AppError } from "@seopilot/shared";
import { expandScopes, type Permission } from "./rbac";
import { writeAuditLog } from "./audit-log";

export const API_KEY_PREFIX = "spk_";

export interface CreatedApiKey {
  id: string;
  /** Full secret; shown exactly once. */
  secret: string;
  prefix: string;
}

export async function createApiKey(input: {
  userId: string;
  organizationId: string;
  name: string;
  scopes: string[];
  projectIds?: string[] | null;
  expiresAt?: Date | null;
  rateLimitPerMinute?: number;
}): Promise<CreatedApiKey> {
  const secret = `${API_KEY_PREFIX}${secureToken(32)}`;
  const prefix = secret.slice(0, 12);
  const keyHash = sha256(secret);
  const scopes = [...expandScopes(input.scopes)];
  return withTenant({ userId: input.userId }, async (tx) => {
    const [row] = await tx
      .insert(schema.apiKeys)
      .values({
        organizationId: input.organizationId,
        createdBy: input.userId,
        name: input.name,
        prefix,
        keyHash,
        scopes,
        projectIds: input.projectIds ?? null,
        expiresAt: input.expiresAt ?? null,
        rateLimitPerMinute: input.rateLimitPerMinute ?? 60,
      })
      .returning({ id: schema.apiKeys.id });
    if (!row) throw new AppError("INTERNAL_ERROR", "API key insert failed");
    await writeAuditLog(tx, { organizationId: input.organizationId, actorUserId: input.userId, action: "api_key.created", targetType: "api_key", targetId: row.id, metadata: { name: input.name, scopes } });
    return { id: row.id, secret, prefix };
  });
}

export async function revokeApiKey(userId: string, organizationId: string, apiKeyId: string): Promise<boolean> {
  return withTenant({ userId }, async (tx) => {
    const [row] = await tx
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.id, apiKeyId), eq(schema.apiKeys.organizationId, organizationId), isNull(schema.apiKeys.revokedAt)))
      .returning({ id: schema.apiKeys.id });
    if (row) await writeAuditLog(tx, { organizationId, actorUserId: userId, action: "api_key.revoked", targetType: "api_key", targetId: apiKeyId });
    return Boolean(row);
  });
}

export interface ResolvedApiKey {
  id: string;
  organizationId: string;
  createdBy: string;
  permissions: Set<Permission>;
  projectIds: string[] | null;
  rateLimitPerMinute: number;
}

/**
 * Validate a bearer API key. Lookup is by SHA-256 hash (constant-time compare on
 * the stored hash for defence in depth). Runs in system context because no
 * tenant is known before the key is resolved; the returned organizationId is
 * then used for the request's tenant context.
 */
export async function resolveApiKey(secret: string): Promise<ResolvedApiKey | null> {
  if (!secret.startsWith(API_KEY_PREFIX) || secret.length < 20) return null;
  const hash = sha256(secret);
  const row = await withSystem(null, async (tx) => {
    const [r] = await tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.keyHash, hash)).limit(1);
    return r ?? null;
  });
  if (!row) return null;
  if (!safeEqual(row.keyHash, hash)) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  // Touch last_used_at without blocking the request.
  void withSystem(row.organizationId, (tx) => tx.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.id))).catch(() => undefined);
  return {
    id: row.id,
    organizationId: row.organizationId,
    createdBy: row.createdBy,
    permissions: expandScopes(row.scopes),
    projectIds: row.projectIds ?? null,
    rateLimitPerMinute: row.rateLimitPerMinute,
  };
}

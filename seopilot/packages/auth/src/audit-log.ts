import { schema, type DbExecutor } from "@seopilot/db";
import { redact } from "@seopilot/shared";

export interface AuditEntry {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorApiKeyId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(tx: DbExecutor, entry: AuditEntry): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    organizationId: entry.organizationId ?? null,
    actorUserId: entry.actorUserId ?? null,
    actorApiKeyId: entry.actorApiKeyId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent?.slice(0, 500) ?? null,
    metadata: redact(entry.metadata ?? {}),
  });
}

/**
 * Tenant context for Row-Level Security.
 *
 * Pattern adapted from RosterSeo `packages/db/src/with-user-context.ts` (MIT):
 * every tenant-scoped query runs inside a transaction that first sets
 * `app.current_user_id` (and optionally `app.current_api_key_org`) via
 * `set_config(..., true)` so the RLS policies in migrations/0002_rls.sql can
 * evaluate membership. If the context is missing, policies evaluate to false
 * and queries return zero rows: fail closed.
 *
 * Two identities are supported:
 *   - user sessions  -> app.current_user_id = <user id>
 *   - API keys       -> app.current_org_id  = <organization id> (+ app.current_user_id = api key creator)
 *   - system/worker  -> app.bypass_rls = 'on' — only the worker role may use this, and only
 *                       inside job handlers that already scoped their work to one organization.
 */
import { sql } from "drizzle-orm";
import { getDb, type Transaction } from "./client";

export interface TenantContext {
  userId?: string;
  organizationId?: string;
  apiKeyId?: string;
}

export async function withTenant<T>(ctx: TenantContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  if (!ctx.userId && !ctx.organizationId) throw new Error("withTenant requires userId or organizationId");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId ?? ""}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.organizationId ?? ""}, true)`);
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
    return fn(tx);
  });
}

/**
 * Worker/system context. Requires the connecting role to have been granted the
 * `seopilot_worker` role (or to be the table owner in self-hosted mode). Every
 * caller must pass the organization it is operating on for logging and for the
 * `app.current_org_id` guard used by a few policies.
 */
export async function withSystem<T>(organizationId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', '', true)`);
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${organizationId ?? ""}, true)`);
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}

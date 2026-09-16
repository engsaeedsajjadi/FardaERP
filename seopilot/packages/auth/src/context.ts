/**
 * Request principal resolution. Every API/route handler goes through
 * `resolvePrincipal` and then `requireOrgAccess` / `requireProjectAccess`, which
 * derive authorization from the authenticated identity — never from a
 * client-supplied organizationId alone (spec §6).
 */
import { and, eq, schema, withTenant, type OrgRole, type Transaction } from "@seopilot/db";
import { AppError } from "@seopilot/shared";
import { createAuth } from "./better-auth";
import { resolveApiKey } from "./api-keys";
import { ROLE_MATRIX, type Permission } from "./rbac";
import { getMembership } from "./organizations";

export type Principal =
  | { kind: "user"; userId: string; email: string; name: string; platformRole: string; sessionId: string; activeOrganizationId: string | null; impersonatedBy: string | null }
  | { kind: "api_key"; apiKeyId: string; userId: string; organizationId: string; permissions: Set<Permission>; projectIds: string[] | null; rateLimitPerMinute: number };

export interface OrgContext {
  principal: Principal;
  organizationId: string;
  role: OrgRole | null;
  permissions: ReadonlySet<Permission>;
  /** null = unrestricted; array = allowed project ids. */
  projectIds: string[] | null;
  /** Tenant context for withTenant(). */
  tenant: { userId?: string; organizationId?: string; apiKeyId?: string };
}

export async function resolvePrincipal(headers: Headers): Promise<Principal | null> {
  const authz = headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    const key = await resolveApiKey(authz.slice(7).trim());
    if (!key) throw new AppError("UNAUTHORIZED", "Invalid API key");
    return { kind: "api_key", apiKeyId: key.id, userId: key.createdBy, organizationId: key.organizationId, permissions: key.permissions, projectIds: key.projectIds, rateLimitPerMinute: key.rateLimitPerMinute };
  }
  const session = await createAuth().api.getSession({ headers });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string; banned?: boolean };
  if (u.banned) throw new AppError("FORBIDDEN", "Account suspended");
  const s = session.session as typeof session.session & { activeOrganizationId?: string | null; impersonatedBy?: string | null };
  return {
    kind: "user",
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    platformRole: u.role ?? "user",
    sessionId: session.session.id,
    activeOrganizationId: s.activeOrganizationId ?? null,
    impersonatedBy: s.impersonatedBy ?? null,
  };
}

export async function requirePrincipal(headers: Headers): Promise<Principal> {
  const p = await resolvePrincipal(headers);
  if (!p) throw new AppError("UNAUTHORIZED", "Authentication required");
  return p;
}

/** Load role permissions from the database (seeded matrix); falls back to the in-code matrix. */
async function loadPermissions(tx: Transaction, role: OrgRole): Promise<ReadonlySet<Permission>> {
  const rows = await tx.select({ key: schema.rolePermissions.permissionKey }).from(schema.rolePermissions).where(eq(schema.rolePermissions.role, role));
  if (rows.length === 0) return ROLE_MATRIX[role];
  return new Set(rows.map((r) => r.key as Permission));
}

export async function requireOrgAccess(principal: Principal, organizationId: string): Promise<OrgContext> {
  if (principal.kind === "api_key") {
    if (principal.organizationId !== organizationId) throw new AppError("NOT_FOUND", "Organization not found");
    return {
      principal,
      organizationId,
      role: null,
      permissions: principal.permissions,
      projectIds: principal.projectIds,
      tenant: { organizationId, userId: principal.userId, apiKeyId: principal.apiKeyId },
    };
  }
  return withTenant({ userId: principal.userId }, async (tx) => {
    const [org] = await tx.select({ id: schema.organizations.id, parentOrganizationId: schema.organizations.parentOrganizationId }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    if (!org) throw new AppError("NOT_FOUND", "Organization not found");
    let membership = await getMembership(tx, principal.userId, organizationId);
    // Agency staff acting on a client organization inherit their agency role.
    if (!membership && org.parentOrganizationId) {
      const parent = await getMembership(tx, principal.userId, org.parentOrganizationId);
      if (parent && ["owner", "admin", "manager", "seo_manager"].includes(parent.role)) membership = { ...parent, organizationId, projectIds: null };
    }
    if (!membership) throw new AppError("NOT_FOUND", "Organization not found");
    const permissions = await loadPermissions(tx, membership.role);
    return { principal, organizationId, role: membership.role, permissions, projectIds: membership.projectIds ?? null, tenant: { userId: principal.userId } };
  });
}

/** Resolve a project by id under the principal's visibility; returns its org context. Never reveals existence across tenants. */
export async function requireProjectAccess(principal: Principal, projectId: string): Promise<OrgContext & { project: typeof schema.projects.$inferSelect }> {
  const tenant = principal.kind === "api_key" ? { organizationId: principal.organizationId, userId: principal.userId } : { userId: principal.userId };
  const project = await withTenant(tenant, async (tx) => {
    const [p] = await tx.select().from(schema.projects).where(and(eq(schema.projects.id, projectId))).limit(1);
    return p ?? null;
  });
  if (!project || project.deletedAt) throw new AppError("NOT_FOUND", "Project not found");
  const ctx = await requireOrgAccess(principal, project.organizationId);
  if (ctx.projectIds && !ctx.projectIds.includes(project.id)) throw new AppError("NOT_FOUND", "Project not found");
  return { ...ctx, project };
}

export function requirePermission(ctx: OrgContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) throw new AppError("FORBIDDEN", `Missing permission: ${permission}`, { permission });
}

export function isPlatformAdmin(principal: Principal): boolean {
  return principal.kind === "user" && principal.platformRole === "admin";
}

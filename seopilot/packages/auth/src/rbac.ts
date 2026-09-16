import { AppError } from "@seopilot/shared";
import type { OrgRole } from "@seopilot/db";

export const PERMISSIONS = [
  "org.read", "org.manage",
  "team.read", "team.invite", "team.remove",
  "project.read", "project.write", "project.delete",
  "seo.audit.run", "seo.audit.read",
  "keyword.read", "keyword.write",
  "rank.read", "rank.run",
  "competitor.read", "competitor.write",
  "backlink.read", "backlink.run",
  "integration.read", "integration.manage",
  "content.read", "content.write",
  "ai.run",
  "reports.read", "reports.generate",
  "automation.read", "automation.manage",
  "billing.read", "billing.manage",
  "api.manage",
  "agency.manage",
  "audit_log.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

/**
 * Default role matrix. The database `role_permissions` table is seeded from the
 * same matrix (migrations/0003_seed_reference.sql) and is the runtime source of
 * truth; this constant is used for tests and as a fallback when the table is
 * unavailable at boot.
 */
export const ROLE_MATRIX: Record<OrgRole, ReadonlySet<Permission>> = {
  owner: ALL,
  admin: ALL,
  manager: new Set(PERMISSIONS.filter((p) => !["org.manage", "billing.manage", "api.manage", "team.remove", "project.delete"].includes(p))),
  seo_manager: new Set<Permission>([
    "org.read", "team.read", "project.read", "project.write", "seo.audit.run", "seo.audit.read", "keyword.read", "keyword.write", "rank.read", "rank.run",
    "competitor.read", "competitor.write", "backlink.read", "backlink.run", "integration.read", "integration.manage", "content.read", "content.write", "ai.run",
    "reports.read", "reports.generate", "automation.read", "automation.manage", "billing.read",
  ]),
  analyst: new Set<Permission>([
    "org.read", "team.read", "project.read", "seo.audit.read", "seo.audit.run", "keyword.read", "keyword.write", "rank.read", "rank.run", "competitor.read",
    "backlink.read", "integration.read", "content.read", "reports.read", "reports.generate", "automation.read",
  ]),
  editor: new Set<Permission>(["org.read", "project.read", "seo.audit.read", "keyword.read", "rank.read", "content.read", "content.write", "ai.run", "reports.read"]),
  client: new Set<Permission>(["project.read", "seo.audit.read", "keyword.read", "rank.read", "competitor.read", "backlink.read", "content.read", "reports.read"]),
  viewer: new Set<Permission>([
    "org.read", "team.read", "project.read", "seo.audit.read", "keyword.read", "rank.read", "competitor.read", "backlink.read", "integration.read", "content.read",
    "reports.read", "automation.read", "billing.read",
  ]),
};

export function roleHas(role: OrgRole, permission: Permission, matrix: Record<OrgRole, ReadonlySet<Permission>> = ROLE_MATRIX): boolean {
  return matrix[role]?.has(permission) ?? false;
}

/** API key scopes map 1:1 onto permissions, plus wildcard groups. */
export function expandScopes(scopes: string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const s of scopes) {
    if (s === "*") PERMISSIONS.forEach((p) => out.add(p));
    else if (s.endsWith(".*")) {
      const prefix = s.slice(0, -1);
      PERMISSIONS.filter((p) => p.startsWith(prefix)).forEach((p) => out.add(p));
    } else if ((PERMISSIONS as readonly string[]).includes(s)) out.add(s as Permission);
  }
  return out;
}

export function assertPermission(granted: ReadonlySet<Permission>, permission: Permission): void {
  if (!granted.has(permission)) throw new AppError("FORBIDDEN", `Missing permission: ${permission}`, { permission });
}

/** Role ranking used to prevent privilege escalation when assigning roles. */
const RANK: Record<OrgRole, number> = { owner: 100, admin: 90, manager: 70, seo_manager: 60, analyst: 50, editor: 40, viewer: 20, client: 10 };

export function canAssignRole(actor: OrgRole, target: OrgRole): boolean {
  if (target === "owner") return false; // ownership transfer is a dedicated flow
  return RANK[actor] > RANK[target] || actor === "owner";
}

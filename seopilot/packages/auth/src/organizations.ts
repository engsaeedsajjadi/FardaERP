import { and, eq, isNull, schema, withTenant, type Transaction, type OrgRole } from "@seopilot/db";
import { AppError, shortId, secureToken, sha256, addDays } from "@seopilot/shared";
import { canAssignRole } from "./rbac";
import { writeAuditLog } from "./audit-log";

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "org";
  return `${base}-${shortId(6)}`;
}

export async function createOrganization(input: {
  userId: string;
  name: string;
  kind?: "standard" | "agency" | "client";
  parentOrganizationId?: string | null;
  timezone?: string;
  billingEmail?: string | null;
}): Promise<{ id: string; slug: string }> {
  return withTenant({ userId: input.userId }, async (tx) => {
    if (input.parentOrganizationId) {
      // Only agency admins/owners of the parent may create client orgs; RLS restricts reads, we verify role too.
      const [m] = await tx
        .select()
        .from(schema.organizationMembers)
        .where(and(eq(schema.organizationMembers.organizationId, input.parentOrganizationId), eq(schema.organizationMembers.userId, input.userId)))
        .limit(1);
      if (!m || !["owner", "admin", "manager"].includes(m.role)) throw new AppError("FORBIDDEN", "Not allowed to create client organizations for this agency");
      const [parent] = await tx.select({ kind: schema.organizations.kind }).from(schema.organizations).where(eq(schema.organizations.id, input.parentOrganizationId)).limit(1);
      if (!parent || parent.kind !== "agency") throw new AppError("VALIDATION_ERROR", "Parent organization is not an agency");
    }
    const [org] = await tx
      .insert(schema.organizations)
      .values({
        name: input.name.trim(),
        slug: slugify(input.name),
        kind: input.kind ?? "standard",
        parentOrganizationId: input.parentOrganizationId ?? null,
        ownerUserId: input.userId,
        timezone: input.timezone ?? "UTC",
        billingEmail: input.billingEmail ?? null,
      })
      .returning({ id: schema.organizations.id, slug: schema.organizations.slug });
    if (!org) throw new AppError("INTERNAL_ERROR", "Organization insert failed");
    await tx.insert(schema.organizationMembers).values({ organizationId: org.id, userId: input.userId, role: "owner" });
    await tx.insert(schema.creditWallets).values({ organizationId: org.id, balance: 0 });
    await writeAuditLog(tx, { organizationId: org.id, actorUserId: input.userId, action: "organization.created", targetType: "organization", targetId: org.id, metadata: { kind: input.kind ?? "standard" } });
    return org;
  });
}

export async function listUserOrganizations(userId: string) {
  return withTenant({ userId }, async (tx) =>
    tx
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        kind: schema.organizations.kind,
        parentOrganizationId: schema.organizations.parentOrganizationId,
        planCode: schema.organizations.planCode,
        role: schema.organizationMembers.role,
      })
      .from(schema.organizations)
      .leftJoin(schema.organizationMembers, and(eq(schema.organizationMembers.organizationId, schema.organizations.id), eq(schema.organizationMembers.userId, userId)))
      .where(isNull(schema.organizations.deletedAt)),
  );
}

export async function getMembership(tx: Transaction, userId: string, organizationId: string) {
  const [m] = await tx
    .select()
    .from(schema.organizationMembers)
    .where(and(eq(schema.organizationMembers.organizationId, organizationId), eq(schema.organizationMembers.userId, userId)))
    .limit(1);
  return m ?? null;
}

export async function inviteMember(input: { actorUserId: string; actorRole: OrgRole; organizationId: string; email: string; role: OrgRole; projectIds?: string[] | null }): Promise<{ token: string; invitationId: string; expiresAt: Date }> {
  if (!canAssignRole(input.actorRole, input.role)) throw new AppError("FORBIDDEN", "Cannot assign a role equal to or higher than your own");
  const token = secureToken(24);
  const expiresAt = addDays(new Date(), 7);
  return withTenant({ userId: input.actorUserId }, async (tx) => {
    const [inv] = await tx
      .insert(schema.organizationInvitations)
      .values({ organizationId: input.organizationId, email: input.email.toLowerCase().trim(), role: input.role, projectIds: input.projectIds ?? null, tokenHash: sha256(token), invitedBy: input.actorUserId, expiresAt })
      .returning({ id: schema.organizationInvitations.id });
    if (!inv) throw new AppError("INTERNAL_ERROR");
    await writeAuditLog(tx, { organizationId: input.organizationId, actorUserId: input.actorUserId, action: "team.invited", targetType: "invitation", targetId: inv.id, metadata: { email: input.email, role: input.role } });
    return { token, invitationId: inv.id, expiresAt };
  });
}

/** Accept runs in system context for the lookup (the invitee is not yet a member), then inserts the membership. */
export async function acceptInvitation(input: { userId: string; userEmail: string; token: string }): Promise<{ organizationId: string }> {
  const { withSystem } = await import("@seopilot/db");
  const hash = sha256(input.token);
  return withSystem(null, async (tx) => {
    const [inv] = await tx.select().from(schema.organizationInvitations).where(eq(schema.organizationInvitations.tokenHash, hash)).limit(1);
    if (!inv || inv.acceptedAt || inv.expiresAt.getTime() < Date.now()) throw new AppError("NOT_FOUND", "Invitation is invalid or expired");
    if (inv.email !== input.userEmail.toLowerCase()) throw new AppError("FORBIDDEN", "This invitation was issued to a different email address");
    const existing = await getMembership(tx, input.userId, inv.organizationId);
    if (!existing) {
      await tx.insert(schema.organizationMembers).values({ organizationId: inv.organizationId, userId: input.userId, role: inv.role, projectIds: inv.projectIds ?? null, invitedBy: inv.invitedBy });
    }
    await tx.update(schema.organizationInvitations).set({ acceptedAt: new Date() }).where(eq(schema.organizationInvitations.id, inv.id));
    await writeAuditLog(tx, { organizationId: inv.organizationId, actorUserId: input.userId, action: "team.invitation_accepted", targetType: "invitation", targetId: inv.id });
    return { organizationId: inv.organizationId };
  });
}

export async function updateMemberRole(input: { actorUserId: string; actorRole: OrgRole; organizationId: string; memberUserId: string; role: OrgRole; projectIds?: string[] | null }): Promise<void> {
  if (!canAssignRole(input.actorRole, input.role)) throw new AppError("FORBIDDEN", "Cannot assign this role");
  await withTenant({ userId: input.actorUserId }, async (tx) => {
    const target = await getMembership(tx, input.memberUserId, input.organizationId);
    if (!target) throw new AppError("NOT_FOUND", "Member not found");
    if (target.role === "owner") throw new AppError("FORBIDDEN", "The owner's role cannot be changed here");
    await tx
      .update(schema.organizationMembers)
      .set({ role: input.role, projectIds: input.projectIds === undefined ? target.projectIds : input.projectIds, updatedAt: new Date() })
      .where(eq(schema.organizationMembers.id, target.id));
    await writeAuditLog(tx, { organizationId: input.organizationId, actorUserId: input.actorUserId, action: "team.role_changed", targetType: "user", targetId: input.memberUserId, metadata: { role: input.role } });
  });
}

export async function removeMember(input: { actorUserId: string; organizationId: string; memberUserId: string }): Promise<void> {
  await withTenant({ userId: input.actorUserId }, async (tx) => {
    const target = await getMembership(tx, input.memberUserId, input.organizationId);
    if (!target) throw new AppError("NOT_FOUND", "Member not found");
    if (target.role === "owner") throw new AppError("FORBIDDEN", "The owner cannot be removed");
    await tx.delete(schema.organizationMembers).where(eq(schema.organizationMembers.id, target.id));
    await writeAuditLog(tx, { organizationId: input.organizationId, actorUserId: input.actorUserId, action: "team.member_removed", targetType: "user", targetId: input.memberUserId });
  });
}

export async function transferOwnership(input: { actorUserId: string; organizationId: string; newOwnerUserId: string }): Promise<void> {
  await withTenant({ userId: input.actorUserId }, async (tx) => {
    const [org] = await tx.select().from(schema.organizations).where(eq(schema.organizations.id, input.organizationId)).limit(1);
    if (!org || org.ownerUserId !== input.actorUserId) throw new AppError("FORBIDDEN", "Only the current owner can transfer ownership");
    const target = await getMembership(tx, input.newOwnerUserId, input.organizationId);
    if (!target) throw new AppError("NOT_FOUND", "New owner must already be a member");
    await tx.update(schema.organizations).set({ ownerUserId: input.newOwnerUserId, updatedAt: new Date() }).where(eq(schema.organizations.id, org.id));
    await tx.update(schema.organizationMembers).set({ role: "owner" }).where(eq(schema.organizationMembers.id, target.id));
    await tx.update(schema.organizationMembers).set({ role: "admin" }).where(and(eq(schema.organizationMembers.organizationId, org.id), eq(schema.organizationMembers.userId, input.actorUserId)));
    await writeAuditLog(tx, { organizationId: org.id, actorUserId: input.actorUserId, action: "organization.ownership_transferred", targetType: "user", targetId: input.newOwnerUserId });
  });
}

import { randomUUID } from "node:crypto";
import { getDb, withTenant, withSystem, schema } from "../../packages/db/src";

/** Insert a user directly (Better Auth owns this table in the app; tests seed it). */
export async function createUser(email = `${randomUUID()}@example.test`): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  await withSystem(null, async (tx) => {
    await tx.insert(schema.users).values({ id, email, name: email.split("@")[0] ?? "user", emailVerified: true });
  });
  return { id, email };
}

export async function createOrgForUser(userId: string, name = "Org", kind: "standard" | "agency" | "client" = "standard", parentOrganizationId?: string): Promise<string> {
  return withTenant({ userId }, async (tx) => {
    const [org] = await tx.insert(schema.organizations).values({ name, slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`, ownerUserId: userId, kind, parentOrganizationId: parentOrganizationId ?? null }).returning();
    if (!org) throw new Error("org insert failed");
    await tx.insert(schema.organizationMembers).values({ organizationId: org.id, userId, role: "owner" });
    return org.id;
  });
}

export async function createProject(userId: string, organizationId: string, domain = `${randomUUID().slice(0, 8)}.example`): Promise<string> {
  return withTenant({ userId }, async (tx) => {
    const [p] = await tx.insert(schema.projects).values({ organizationId, name: domain, domain, siteUrl: `https://${domain}`, createdBy: userId }).returning();
    if (!p) throw new Error("project insert failed");
    return p.id;
  });
}

export { getDb, withTenant, withSystem, schema };

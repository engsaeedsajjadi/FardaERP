/**
 * Spec §50: automated proof that RLS isolates tenants using the restricted app role.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq, sql } from "../../packages/db/src";
import { createUser, createOrgForUser, createProject, withTenant, withSystem, schema, getDb } from "./helpers";

let userA: { id: string }, userB: { id: string };
let orgA: string, orgB: string, projectA: string, projectB: string;

beforeAll(async () => {
  // Sanity: the test connection must NOT bypass RLS.
  const res = await getDb().execute<{ rolbypassrls: boolean; rolsuper: boolean }>(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`);
  expect(res.rows[0]?.rolbypassrls).toBe(false);
  expect(res.rows[0]?.rolsuper).toBe(false);

  userA = await createUser();
  userB = await createUser();
  orgA = await createOrgForUser(userA.id, "AlphaCo");
  orgB = await createOrgForUser(userB.id, "BetaCo");
  projectA = await createProject(userA.id, orgA);
  projectB = await createProject(userB.id, orgB);
});

describe("tenant isolation (RLS)", () => {
  it("user A sees only their organization and project", async () => {
    const orgs = await withTenant({ userId: userA.id }, (tx) => tx.select().from(schema.organizations));
    expect(orgs.map((o) => o.id)).toEqual([orgA]);
    const projects = await withTenant({ userId: userA.id }, (tx) => tx.select().from(schema.projects));
    expect(projects.map((p) => p.id)).toEqual([projectA]);
  });

  it("user A cannot read user B's project by id", async () => {
    const rows = await withTenant({ userId: userA.id }, (tx) => tx.select().from(schema.projects).where(eq(schema.projects.id, projectB)));
    expect(rows).toHaveLength(0);
  });

  it("user A cannot update user B's project", async () => {
    const updated = await withTenant({ userId: userA.id }, (tx) => tx.update(schema.projects).set({ name: "hacked" }).where(eq(schema.projects.id, projectB)).returning());
    expect(updated).toHaveLength(0);
    const check = await withTenant({ userId: userB.id }, (tx) => tx.select().from(schema.projects).where(eq(schema.projects.id, projectB)));
    expect(check[0]?.name).not.toBe("hacked");
  });

  it("user A cannot delete user B's project", async () => {
    const deleted = await withTenant({ userId: userA.id }, (tx) => tx.delete(schema.projects).where(eq(schema.projects.id, projectB)).returning());
    expect(deleted).toHaveLength(0);
  });

  it("user A cannot insert a project into user B's organization", async () => {
    await expect(
      withTenant({ userId: userA.id }, (tx) => tx.insert(schema.projects).values({ organizationId: orgB, name: "x", domain: "x.example", siteUrl: "https://x.example", createdBy: userA.id })),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });
  });

  it("user A cannot read user B's reports, jobs, API keys, credit wallet or billing", async () => {
    await withSystem(orgB, async (tx) => {
      await tx.insert(schema.reports).values({ projectId: projectB, organizationId: orgB, type: "seo", format: "pdf", title: "B report" });
      await tx.insert(schema.jobs).values({ organizationId: orgB, projectId: projectB, type: "SITE_CRAWL" });
      await tx.insert(schema.apiKeys).values({ organizationId: orgB, createdBy: userB.id, name: "k", prefix: "spk_b", keyHash: "hashB" });
      await tx.insert(schema.creditWallets).values({ organizationId: orgB, balance: 500 });
      await tx.insert(schema.subscriptions).values({ organizationId: orgB, planCode: "free", status: "active" });
    });
    const asA = await withTenant({ userId: userA.id }, async (tx) => ({
      reports: await tx.select().from(schema.reports),
      jobs: await tx.select().from(schema.jobs),
      keys: await tx.select().from(schema.apiKeys),
      wallets: await tx.select().from(schema.creditWallets),
      subs: await tx.select().from(schema.subscriptions),
    }));
    expect(asA.reports).toHaveLength(0);
    expect(asA.jobs).toHaveLength(0);
    expect(asA.keys).toHaveLength(0);
    expect(asA.wallets).toHaveLength(0);
    expect(asA.subs).toHaveLength(0);
    const asB = await withTenant({ userId: userB.id }, (tx) => tx.select().from(schema.reports));
    expect(asB).toHaveLength(1);
  });

  it("queries without tenant context return nothing (fail closed)", async () => {
    const rows = await getDb().select().from(schema.projects);
    expect(rows).toHaveLength(0);
  });

  it("API-key context scoped to org B cannot see org A", async () => {
    const rows = await withTenant({ organizationId: orgB }, (tx) => tx.select().from(schema.projects));
    expect(rows.map((r) => r.id)).toEqual([projectB]);
  });

  it("member restricted to specific projects cannot see other projects in the same org", async () => {
    const restricted = await createUser();
    const projectA2 = await createProject(userA.id, orgA, "second.example");
    await withTenant({ userId: userA.id }, (tx) => tx.insert(schema.organizationMembers).values({ organizationId: orgA, userId: restricted.id, role: "client", projectIds: [projectA2] }));
    const visible = await withTenant({ userId: restricted.id }, (tx) => tx.select().from(schema.projects));
    expect(visible.map((p) => p.id)).toEqual([projectA2]);
    const crawl = await withTenant({ userId: restricted.id }, (tx) => tx.select().from(schema.crawlRuns).where(eq(schema.crawlRuns.projectId, projectA)));
    expect(crawl).toHaveLength(0);
  });

  it("agency admins see client organizations; client members do not see the agency", async () => {
    const agencyOwner = await createUser();
    const agencyId = await createOrgForUser(agencyOwner.id, "Agency", "agency");
    const clientId = await createOrgForUser(agencyOwner.id, "ClientCo", "client", agencyId);
    const clientUser = await createUser();
    await withTenant({ userId: agencyOwner.id }, (tx) => tx.insert(schema.organizationMembers).values({ organizationId: clientId, userId: clientUser.id, role: "client" }));

    const agencyView = await withTenant({ userId: agencyOwner.id }, (tx) => tx.select().from(schema.organizations));
    expect(agencyView.map((o) => o.id).sort()).toEqual([agencyId, clientId].sort());

    const clientView = await withTenant({ userId: clientUser.id }, (tx) => tx.select().from(schema.organizations));
    expect(clientView.map((o) => o.id)).toEqual([clientId]);
  });

  it("system context (worker) can read across organizations", async () => {
    const all = await withSystem(null, (tx) => tx.select().from(schema.projects));
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});

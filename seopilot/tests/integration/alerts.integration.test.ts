/** Alert rule evaluation on measured data: rank drops, GSC click drops, cooldown + dedupe. */
import { beforeAll, describe, expect, it } from "vitest";
import { processAlertsForOrganization, type NotifyInput } from "../../packages/notifications/src";
import { createOrgForUser, createProject, createUser, withTenant, schema } from "./helpers";
import { eq } from "../../packages/db/src";

let userId: string, orgId: string, projectId: string;
const sent: NotifyInput[] = [];
const dispatch = async (input: NotifyInput) => {
  sent.push(input);
  const id = await withTenant({ userId, organizationId: orgId }, async (tx) => (await tx.insert(schema.notifications).values({ organizationId: input.organizationId, projectId: input.projectId ?? null, ruleId: input.ruleId ?? null, event: input.event, severity: input.severity, title: input.title, body: input.body, data: input.data ?? {}, deliveries: [] }).returning({ id: schema.notifications.id }))[0]!.id);
  return { notificationId: id, deliveries: [] };
};
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  userId = (await createUser("alerts-owner@example.com")).id;
  orgId = await createOrgForUser(userId, "Alerts Org", "standard");
  projectId = await createProject(userId, orgId, "alerts.example");
  await withTenant({ userId, organizationId: orgId }, async (tx) => {
    const [kw] = await tx.insert(schema.keywords).values({ projectId, organizationId: orgId, keyword: "seo tools", normalizedKeyword: "seo tools", country: "US", language: "en", device: "desktop", createdBy: userId }).returning({ id: schema.keywords.id });
    await tx.insert(schema.keywordRankings).values([
      { keywordId: kw!.id, projectId, organizationId: orgId, checkedOn: day(1), position: 4, previousPosition: 5, url: "https://alerts.example/a", provider: "fake", serpFeatures: [], searchEngine: "google", country: "US", language: "en", device: "desktop" },
      { keywordId: kw!.id, projectId, organizationId: orgId, checkedOn: day(0), position: 12, previousPosition: 4, url: "https://alerts.example/a", provider: "fake", serpFeatures: [], searchEngine: "google", country: "US", language: "en", device: "desktop" },
    ]);
    // GSC: previous week 100 clicks/day, current week 40/day (−60%)
    const [conn] = await tx.insert(schema.gscConnections).values({ projectId, organizationId: orgId, siteUrl: "sc-domain:alerts.example", encryptedRefreshToken: "x", scopes: [], status: "connected", connectedBy: userId }).returning({ id: schema.gscConnections.id });
    const rows = [];
    for (let i = 2; i < 16; i++) rows.push({ projectId, organizationId: orgId, connectionId: conn!.id, date: day(i), dimension: "date", keyHash: `h${i}`, searchType: "web", clicks: i < 9 ? 40 : 100, impressions: 1000, ctr: 0.05, position: 5 });
    await tx.insert(schema.gscMetrics).values(rows as never);
    await tx.insert(schema.creditWallets).values({ organizationId: orgId, balance: 0 });
    await tx.insert(schema.notificationRules).values([
      { organizationId: orgId, projectId, name: "drops", event: "rank_drop", condition: { positions: 5, topN: 30 }, channels: [{ type: "dashboard" }], cooldownMinutes: 60, createdBy: userId },
      { organizationId: orgId, projectId: null, name: "clicks", event: "clicks_drop", condition: { percent: 25, windowDays: 7 }, channels: [{ type: "dashboard" }], createdBy: userId },
      { organizationId: orgId, projectId: null, name: "credits", event: "credit_low", condition: {}, channels: [{ type: "dashboard" }], createdBy: userId },
    ]);
  });
});

describe("alerts", () => {
  it("triggers rank_drop and clicks_drop from measured data; credit_low when wallet is empty", async () => {
    const r = await withTenant({ userId, organizationId: orgId }, (tx) => processAlertsForOrganization(tx, orgId, { dispatch }));
    expect(r.evaluated).toBe(3);
    const events = sent.map((s) => s.event).sort();
    expect(events).toEqual(["clicks_drop", "credit_low", "rank_drop"]);
    const drop = sent.find((s) => s.event === "rank_drop")!;
    expect(drop.title).toContain('"seo tools" dropped from #4 to #12');
    expect(drop.severity).toBe("warning");
    const clicks = sent.find((s) => s.event === "clicks_drop")!;
    expect(clicks.title).toMatch(/down 60%/);
    expect(clicks.severity).toBe("critical");
  });

  it("does not re-alert the same facts (dedupe) and honours cooldown", async () => {
    sent.length = 0;
    const r = await withTenant({ userId, organizationId: orgId }, (tx) => processAlertsForOrganization(tx, orgId, { dispatch }));
    expect(sent.length).toBe(0);
    expect(r.suppressed).toBeGreaterThan(0);
    // new fact within cooldown → suppressed; after cooldown → sent
    await withTenant({ userId, organizationId: orgId }, async (tx) => {
      const [kw] = await tx.select({ id: schema.keywords.id }).from(schema.keywords).where(eq(schema.keywords.projectId, projectId));
      await tx.update(schema.keywordRankings).set({ position: 25, previousPosition: 12 }).where(eq(schema.keywordRankings.keywordId, kw!.id));
    });
    await withTenant({ userId, organizationId: orgId }, (tx) => processAlertsForOrganization(tx, orgId, { dispatch }));
    expect(sent.length).toBe(0);
    await withTenant({ userId, organizationId: orgId }, (tx) => tx.update(schema.notificationRules).set({ lastTriggeredAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(schema.notificationRules.event, "rank_drop")));
    await withTenant({ userId, organizationId: orgId }, (tx) => processAlertsForOrganization(tx, orgId, { dispatch }));
    expect(sent.length).toBe(0); // same checkedOn day + keyword ⇒ same dedupe key; nothing new to say
  });
});

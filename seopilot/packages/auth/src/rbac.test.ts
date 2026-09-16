import { describe, it, expect } from "vitest";
import { ROLE_MATRIX, roleHas, expandScopes, canAssignRole, PERMISSIONS } from "./rbac";

describe("RBAC matrix", () => {
  it("owner and admin have every permission", () => {
    for (const p of PERMISSIONS) {
      expect(roleHas("owner", p)).toBe(true);
      expect(roleHas("admin", p)).toBe(true);
    }
  });
  it("client cannot manage billing, team, or run audits", () => {
    expect(roleHas("client", "billing.manage")).toBe(false);
    expect(roleHas("client", "team.invite")).toBe(false);
    expect(roleHas("client", "seo.audit.run")).toBe(false);
    expect(roleHas("client", "reports.read")).toBe(true);
  });
  it("viewer is read-only", () => {
    for (const p of ROLE_MATRIX.viewer) expect(p.endsWith(".read")).toBe(true);
  });
  it("expands scopes", () => {
    expect(expandScopes(["*"]).size).toBe(PERMISSIONS.length);
    expect([...expandScopes(["keyword.*"])].sort()).toEqual(["keyword.read", "keyword.write"]);
    expect(expandScopes(["bogus"]).size).toBe(0);
  });
  it("prevents privilege escalation", () => {
    expect(canAssignRole("manager", "admin")).toBe(false);
    expect(canAssignRole("manager", "analyst")).toBe(true);
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("owner", "admin")).toBe(true);
  });
});

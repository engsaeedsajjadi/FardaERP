// Regenerates packages/db/migrations/0005_audit_rules.sql from the audit rule catalog.
// Usage (from seopilot/): node --import tsx scripts/gen-audit-rules-migration.mjs
import { writeFileSync } from "node:fs";
const { ruleCatalog } = await import("../packages/audit/src/index.ts");
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const rows = ruleCatalog().map((r) => `(${q(r.id)}, ${q(r.category)}, ${q(r.severity)}, ${q(r.title)}, ${q(r.description)}, ${q(r.recommendation)}, ${q(r.documentationUrl ?? null)}, ${Number(r.weight ?? 1)})`);
const sql = `-- Generated from packages/audit ruleCatalog() by scripts/gen-audit-rules-migration.mjs. Do not edit by hand.
INSERT INTO audit_rules (id, category, severity, title, description, recommendation, documentation_url, weight)
VALUES
${rows.join(",\n")}
ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category, severity = EXCLUDED.severity, title = EXCLUDED.title, description = EXCLUDED.description, recommendation = EXCLUDED.recommendation, documentation_url = EXCLUDED.documentation_url, weight = EXCLUDED.weight, updated_at = now();
`;
writeFileSync(process.argv[2] ?? "packages/db/migrations/0005_audit_rules.sql", sql);
console.log(`wrote ${rows.length} rules`);

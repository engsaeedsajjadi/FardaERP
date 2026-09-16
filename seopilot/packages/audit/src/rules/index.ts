import { contentRules } from "./content";
import { indexabilityRules } from "./indexability";
import { linkRules } from "./links";
import { metadataRules } from "./metadata";
import { imageRules, internationalRules, structuredDataRules } from "./rich";
import { mobileRules, performanceRules, securityRules } from "./technical";
import type { RuleDefinition } from "../types";

export const ALL_RULES: readonly RuleDefinition[] = Object.freeze([
  ...indexabilityRules,
  ...metadataRules,
  ...contentRules,
  ...linkRules,
  ...performanceRules,
  ...securityRules,
  ...mobileRules,
  ...structuredDataRules,
  ...imageRules,
  ...internationalRules,
]);

const ids = new Set<string>();
for (const r of ALL_RULES) {
  if (ids.has(r.id)) throw new Error(`duplicate audit rule id ${r.id}`);
  ids.add(r.id);
}

export const RULES_BY_ID: ReadonlyMap<string, RuleDefinition> = new Map(ALL_RULES.map((r) => [r.id, r]));

/** Serialisable rule catalogue (what gets upserted into audit_rules and shown in docs/UI). */
export function ruleCatalog() {
  return ALL_RULES.map((r) => ({
    id: r.id,
    category: r.category,
    severity: r.severity,
    title: r.title,
    description: r.description,
    recommendation: r.recommendation,
    documentationUrl: r.documentationUrl,
    weight: r.weight,
    scope: r.scope,
  }));
}

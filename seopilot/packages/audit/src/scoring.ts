/**
 * Transparent scoring.
 *
 *   penalty(rule)   = severityImpact × ruleWeight × affectedRatio
 *   category score  = clamp(100 − Σ penalty(rules in category), 0, 100)
 *   overall score   = Σ category score × category weight / Σ category weight
 *
 * affectedRatio is affected/applicable for page rules (so one missing title
 * out of 1,000 pages costs 0.1% of the impact, not all of it) and 1 for site
 * rules. Every number that contributed is returned in `AuditResult.rules` and
 * `scoreBreakdown[*].explanation`, so a score can always be reproduced by hand.
 */
import type { Category, CategoryScore, RuleResult, Severity } from "./types";

export const SCORING_VERSION = "2026.09-v1";

export const SEVERITY_IMPACT: Record<Severity, number> = { critical: 30, high: 18, medium: 9, low: 4, notice: 0 };

export const CATEGORY_WEIGHTS: Record<Category, number> = {
  indexability: 20,
  content: 15,
  metadata: 15,
  links: 15,
  performance: 10,
  security: 5,
  structured_data: 5,
  images: 5,
  international: 5,
  mobile: 5,
};

export function rulePenalty(severity: Severity, weight: number, affectedRatio: number): number {
  const ratio = Math.min(1, Math.max(0, affectedRatio));
  return round2(SEVERITY_IMPACT[severity] * weight * ratio);
}

export function scoreCategories(rules: RuleResult[]): { overall: number; breakdown: Record<string, CategoryScore> } {
  const breakdown: Record<string, CategoryScore> = {};
  let weighted = 0;
  let totalWeight = 0;
  for (const category of Object.keys(CATEGORY_WEIGHTS) as Category[]) {
    const inCat = rules.filter((r) => r.category === category);
    const penalty = inCat.reduce((s, r) => s + r.penalty, 0);
    const findings = inCat.reduce((s, r) => s + r.findings, 0);
    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
    const top = inCat
      .filter((r) => r.penalty > 0)
      .sort((a, b) => b.penalty - a.penalty)
      .slice(0, 5)
      .map((r) => ({ ruleId: r.ruleId, penalty: r.penalty, findings: r.findings }));
    const explanation = top.length
      ? `100 − ${round2(penalty)} = ${score}. Largest deductions: ${top.map((t) => `${t.ruleId} (−${t.penalty}, ${t.findings} finding${t.findings === 1 ? "" : "s"})`).join("; ")}.`
      : `No deductions in ${inCat.length} rule${inCat.length === 1 ? "" : "s"} evaluated.`;
    const weight = CATEGORY_WEIGHTS[category];
    breakdown[category] = { score, weight, findings, explanation, topRules: top };
    weighted += score * weight;
    totalWeight += weight;
  }
  return { overall: totalWeight ? Math.round(weighted / totalWeight) : 0, breakdown };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

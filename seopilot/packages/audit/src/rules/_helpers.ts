import type { AuditContext, AuditPage, RuleDefinition } from "../types";

export const DOCS = {
  google: (slug: string) => `https://developers.google.com/search/docs/${slug}`,
  webdev: (slug: string) => `https://web.dev/articles/${slug}`,
  mdn: (slug: string) => `https://developer.mozilla.org/en-US/docs/Web/${slug}`,
  schema: (type: string) => `https://schema.org/${type}`,
};

export const isOk = (p: AuditPage): boolean => p.isHtml && p.statusCode !== null && p.statusCode >= 200 && p.statusCode < 300;
export const isIndexableOk = (p: AuditPage, _ctx?: AuditContext): boolean => isOk(p) && p.isIndexable;
export const every = (_p: AuditPage): boolean => true;
export const fetched = (p: AuditPage): boolean => p.statusCode !== null;

export function defineRule(rule: RuleDefinition): RuleDefinition {
  if (rule.scope === "page" && !rule.checkPage) throw new Error(`rule ${rule.id} is page-scoped but has no checkPage`);
  if (rule.scope === "site" && !rule.checkSite) throw new Error(`rule ${rule.id} is site-scoped but has no checkSite`);
  if (rule.weight < 1 || rule.weight > 3) throw new Error(`rule ${rule.id} weight must be 1–3`);
  if (!/^[a-z_]+(\.[a-z0-9_]+)+$/.test(rule.id)) throw new Error(`rule id ${rule.id} must be dotted lower-case`);
  return rule;
}

export function trunc(s: string | null, n = 200): string | null {
  return s === null ? null : s.length > n ? `${s.slice(0, n)}…` : s;
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Group pages by a key; returns groups with ≥2 members. */
export function duplicates<T>(items: T[], key: (t: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    const arr = groups.get(k);
    if (arr) arr.push(it);
    else groups.set(k, [it]);
  }
  for (const [k, v] of groups) if (v.length < 2) groups.delete(k);
  return groups;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

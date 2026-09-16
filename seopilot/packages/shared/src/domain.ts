/**
 * Domain normalisation shared by projects, competitors, rank matching and the
 * crawler. Kept dependency-free: registrable-domain logic is only needed in a
 * few places and uses `tldts` there.
 */
export function normalizeDomain(input: string): string {
  let host = input.trim().toLowerCase();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      /* fall through to plain handling */
    }
  }
  host = host.replace(/^\/+|\/+$/g, "").split("/")[0] ?? host;
  host = host.split("?")[0] ?? host;
  host = host.split("#")[0] ?? host;
  host = host.replace(/\.$/, "");
  return host;
}

export function stripWww(host: string): string {
  return host.replace(/^www\./, "");
}

export function domainMatches(candidate: string, target: string, includeSubdomains = true): boolean {
  const c = stripWww(normalizeDomain(candidate));
  const t = stripWww(normalizeDomain(target));
  if (c === t) return true;
  return includeSubdomains && c.endsWith(`.${t}`);
}

const DOMAIN_RE = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i;

export function isValidDomain(host: string): boolean {
  return DOMAIN_RE.test(host);
}

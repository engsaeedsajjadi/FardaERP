/**
 * Measured (not model-interpreted) signals from an AI answer:
 * brand mentions by literal/alias match, competitor domain/brand mentions,
 * and citations by URL extraction. Pure functions — unit tested.
 */
export interface BrandProfile {
  brandName: string | null;
  aliases: string[];
  domain: string;
}

export interface CompetitorProfile {
  domain: string;
  name?: string | null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Accepts a hostname or URL; returns the lower-cased host without "www.". */
export const rootDomain = (hostOrUrl: string): string => {
  let host = hostOrUrl.trim().toLowerCase();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      /* keep as-is */
    }
  }
  return host.replace(/^www\./, "").replace(/\/.*$/, "");
};

/** Whole-word mentions; longer terms are matched first and masked so "rival.example" doesn't also count as "rival". */
function countMentions(text: string, terms: string[]): number {
  let n = 0;
  let lower = text.toLowerCase();
  const uniq = [...new Set(terms.map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length);
  for (const t of uniq) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(t)})(?=$|[^\\p{L}\\p{N}])`, "giu");
    lower = lower.replace(re, (_m, pre: string, hit: string) => {
      n++;
      return pre + " ".repeat(hit.length);
    });
  }
  return n;
}

export function extractUrls(text: string, providerCitations: string[] = []): string[] {
  const found = text.match(/https?:\/\/[^\s)\]}>"'`]+/gi) ?? [];
  const all = [...providerCitations, ...found].map((u) => u.replace(/[.,;:!?]+$/, ""));
  return [...new Set(all)];
}

export function measureAnswer(answer: string, brand: BrandProfile, competitors: CompetitorProfile[], providerCitations: string[] = []) {
  // Mentions are counted in prose only; URLs are measured separately as citations.
  const prose = answer.replace(/https?:\/\/[^\s)\]}>"'`]+/gi, " ");
  const brandTerms = [brand.brandName, ...brand.aliases, rootDomain(brand.domain)].filter((x): x is string => Boolean(x));
  const brandMentionCount = countMentions(prose, brandTerms);
  const competitorMentions = competitors
    .map((c) => ({ domain: rootDomain(c.domain), count: countMentions(prose, [c.name, rootDomain(c.domain)].filter((x): x is string => Boolean(x))) }))
    .filter((c) => c.count > 0);
  const citations = extractUrls(answer, providerCitations).map((url) => {
    let host = "";
    try {
      host = rootDomain(new URL(url).hostname);
    } catch {
      host = "";
    }
    const bd = rootDomain(brand.domain);
    return { url, domain: host, isBrand: host === bd || host.endsWith(`.${bd}`) };
  }).filter((c) => c.domain);
  return { brandMentioned: brandMentionCount > 0, brandMentionCount, competitorMentions, citations, brandCited: citations.some((c) => c.isBrand) };
}

export function summarize(results: Array<{ provider: string; brandMentioned: boolean; competitorMentions: Array<{ count: number }>; citations: unknown[] }>) {
  const out: Record<string, { brandMentions: number; competitorMentions: number; citations: number; answers: number }> = {};
  for (const r of results) {
    const s = (out[r.provider] ??= { brandMentions: 0, competitorMentions: 0, citations: 0, answers: 0 });
    s.answers++;
    if (r.brandMentioned) s.brandMentions++;
    s.competitorMentions += r.competitorMentions.reduce((n, c) => n + c.count, 0);
    s.citations += r.citations.length;
  }
  return out;
}

/** Share of answers mentioning the brand, 0–100, null when no answers were measured. */
export function visibilityShare(summary: ReturnType<typeof summarize>): number | null {
  const all = Object.values(summary);
  const answers = all.reduce((n, s) => n + s.answers, 0);
  if (!answers) return null;
  return Math.round((all.reduce((n, s) => n + s.brandMentions, 0) / answers) * 100);
}

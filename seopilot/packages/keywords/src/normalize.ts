/** Keyword normalisation, intent heuristics and transparent clustering. */
export function normalizeKeyword(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"']/g, "")
    .replace(/[^\p{L}\p{N}\s\-+.&/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Intent = "informational" | "navigational" | "commercial" | "transactional";

const TRANSACTIONAL = /\b(buy|purchase|order|price|prices|pricing|cheap|discount|coupon|deal|deals|for sale|subscribe|download|book|hire|quote|near me|delivery)\b/i;
const COMMERCIAL = /\b(best|top|review|reviews|vs|versus|compare|comparison|alternative|alternatives|rating|ratings|cheapest|affordable|premium|software|tool|tools|service|services|agency|company|companies)\b/i;
const INFORMATIONAL = /^(how|what|why|when|where|who|which|can|does|do|is|are|should|guide|tutorial|examples?|ideas?|tips?|meaning|definition)\b|\b(how to|what is|guide|tutorial|examples?|tips|ideas|meaning|definition|learn|checklist|template)\b/i;

/** Heuristic intent (used only when the provider does not return `main_intent`; always tagged intentSource = "heuristic"). */
export function heuristicIntent(keyword: string, brandTerms: string[] = []): Intent {
  const k = keyword.toLowerCase();
  if (brandTerms.some((b) => b && k.includes(b.toLowerCase()))) return "navigational";
  if (TRANSACTIONAL.test(k)) return "transactional";
  if (COMMERCIAL.test(k)) return "commercial";
  if (INFORMATIONAL.test(k)) return "informational";
  if (/\b(login|sign in|signin|account|official|website|\.com|\.io)\b/.test(k)) return "navigational";
  return "informational";
}

const STOP = new Set(["the", "a", "an", "of", "for", "to", "in", "on", "and", "or", "with", "is", "are", "how", "what", "why", "do", "does", "my", "your", "vs", "best", "top", "free"]);

export function tokens(keyword: string): string[] {
  return normalizeKeyword(keyword)
    .split(/[\s\-/]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

/** Tiny suffix stemmer (deterministic, language-agnostic-ish). */
export function stem(t: string): string {
  return t.replace(/(ies)$/, "y").replace(/(sses)$/, "ss").replace(/([^s])s$/, "$1").replace(/(ing|ed)$/, "");
}

export interface Cluster {
  label: string;
  keywords: string[];
  /** Explanation of how the cluster was formed. */
  method: "token_overlap";
  meta: { threshold: number; sharedTokens: string[] };
}

/**
 * Greedy agglomerative clustering by Jaccard token overlap. Keywords are sorted
 * by (volume desc, alpha) so the highest-volume keyword seeds each cluster and
 * becomes its label. Threshold 0.5 = at least half the tokens shared.
 */
export function clusterKeywords(items: Array<{ keyword: string; searchVolume?: number | null }>, threshold = 0.5): Cluster[] {
  const sorted = [...items].sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || a.keyword.localeCompare(b.keyword));
  const clusters: Array<{ label: string; keywords: string[]; tokenSet: Set<string> }> = [];
  for (const it of sorted) {
    const toks = new Set(tokens(it.keyword));
    let best: { c: (typeof clusters)[number]; score: number } | null = null;
    for (const c of clusters) {
      const inter = [...toks].filter((t) => c.tokenSet.has(t)).length;
      const union = new Set([...toks, ...c.tokenSet]).size;
      const score = union ? inter / union : 0;
      if (score >= threshold && (!best || score > best.score)) best = { c, score };
    }
    if (best) {
      best.c.keywords.push(it.keyword);
    } else {
      clusters.push({ label: it.keyword, keywords: [it.keyword], tokenSet: toks });
    }
  }
  return clusters.map((c) => {
    const shared = [...c.tokenSet].filter((t) => c.keywords.every((k) => tokens(k).includes(t)));
    return { label: c.label, keywords: c.keywords, method: "token_overlap" as const, meta: { threshold, sharedTokens: shared } };
  });
}

/** Question keywords (for AEO / FAQ content). */
export function isQuestion(keyword: string): boolean {
  return /^(how|what|why|when|where|who|which|can|does|do|is|are|should|will|could|would)\b/i.test(keyword.trim()) || keyword.trim().endsWith("?");
}

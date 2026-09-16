/**
 * Deterministic quality checks applied to every AI content output before it is
 * shown. These are measurements (length, keyword presence, duplication), not
 * model opinions — spec §29 "no fabricated quality".
 */
export interface QualityCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export const LIMITS = { titleMin: 30, titleMax: 60, metaMin: 70, metaMax: 155, keywordDensityMax: 0.03 } as const;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function checkTitle(title: string, keywords: string[]): QualityCheck[] {
  const len = title.trim().length;
  return [
    { check: "title.length", passed: len >= LIMITS.titleMin && len <= LIMITS.titleMax, detail: `${len} chars (target ${LIMITS.titleMin}–${LIMITS.titleMax})` },
    { check: "title.keyword", passed: keywords.length === 0 || keywords.some((k) => norm(title).includes(norm(k))), detail: keywords.length ? `contains one of: ${keywords.join(", ")}` : "no target keywords" },
    { check: "title.no_clickbait_punctuation", passed: !/[!]{2,}|\?{2,}|[A-Z]{6,}/.test(title), detail: "no repeated !/? or shouting caps" },
  ];
}

export function checkMeta(desc: string, keywords: string[]): QualityCheck[] {
  const len = desc.trim().length;
  return [
    { check: "meta.length", passed: len >= LIMITS.metaMin && len <= LIMITS.metaMax, detail: `${len} chars (target ${LIMITS.metaMin}–${LIMITS.metaMax})` },
    { check: "meta.keyword", passed: keywords.length === 0 || keywords.some((k) => norm(desc).includes(norm(k))), detail: keywords.length ? `contains one of: ${keywords.join(", ")}` : "no target keywords" },
  ];
}

export function keywordDensity(text: string, keyword: string): number {
  const words = norm(text).split(" ").filter(Boolean);
  if (!words.length) return 0;
  const kw = norm(keyword).split(" ");
  let hits = 0;
  for (let i = 0; i + kw.length <= words.length; i++) if (kw.every((w, j) => words[i + j] === w)) hits++;
  return (hits * kw.length) / words.length;
}

export function checkBody(text: string, keywords: string[], minWords = 300): QualityCheck[] {
  const words = norm(text).split(" ").filter(Boolean).length;
  const out: QualityCheck[] = [{ check: "body.length", passed: words >= minWords, detail: `${words} words (min ${minWords})` }];
  for (const k of keywords) {
    const d = keywordDensity(text, k);
    out.push({ check: `body.density:${k}`, passed: d > 0 && d <= LIMITS.keywordDensityMax, detail: `${(d * 100).toFixed(2)}% (present, ≤ ${LIMITS.keywordDensityMax * 100}%)` });
  }
  return out;
}

/** Flags outputs that are near-duplicates of existing text (Jaccard on word shingles). */
export function similarity(a: string, b: string, n = 3): number {
  const sh = (t: string) => {
    const w = norm(t).split(" ").filter(Boolean);
    const s = new Set<string>();
    for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(" "));
    return s;
  };
  const A = sh(a), B = sh(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function checkUnique(text: string, existing: string[], threshold = 0.5): QualityCheck {
  const max = existing.reduce((m, e) => Math.max(m, similarity(text, e)), 0);
  return { check: "uniqueness", passed: max < threshold, detail: `max similarity to existing content ${(max * 100).toFixed(0)}%` };
}

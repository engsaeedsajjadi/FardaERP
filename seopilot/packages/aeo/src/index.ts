/**
 * Answer Engine Optimization readiness (spec §31): deterministic analysis of a
 * crawled page for featured-snippet / AI-answer eligibility. Every signal is
 * measured from the page; recommendations are rule-based.
 */
import type { PageAnalysis } from "@seopilot/crawler";

export interface AeoSignal {
  id: string;
  passed: boolean;
  weight: number;
  detail: string;
  recommendation: string;
}

export interface AeoReadiness {
  score: number; // 0–100, share of weighted signals passed
  signals: AeoSignal[];
  questionHeadings: string[];
  answerCandidates: Array<{ heading: string; answer: string; words: number }>;
}

const QUESTION_RE = /^(who|what|when|where|why|how|which|can|does|do|is|are|should|will)\b|\?$/i;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Paragraph-like answer immediately following each heading, from the text sample when available. */
function answerAfterHeading(textSample: string, heading: string): string | null {
  const i = textSample.toLowerCase().indexOf(heading.toLowerCase());
  if (i < 0) return null;
  const after = textSample.slice(i + heading.length).trim();
  const sentences = splitSentences(after).slice(0, 3);
  return sentences.length ? sentences.join(" ") : null;
}

export function analyzeAeo(page: PageAnalysis, opts: { schemaTypes?: string[] } = {}): AeoReadiness {
  const headings = page.headingOutline.map((h) => h.text.trim()).filter(Boolean);
  const questionHeadings = headings.filter((h) => QUESTION_RE.test(h));
  const opening = splitSentences(page.textSample).slice(0, 3).join(" ");
  const answerCandidates = questionHeadings.map((h) => {
    // The H1 usually precedes the extracted body text, so its answer is the opening paragraph.
    const answer = answerAfterHeading(page.textSample, h) ?? (page.h1s.includes(h) && opening ? opening : null);
    return answer ? { heading: h, answer, words: answer.split(/\s+/).length } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  const conciseAnswers = answerCandidates.filter((a) => a.words >= 25 && a.words <= 70);
  const sdTypes = new Set([...(opts.schemaTypes ?? []), ...page.structuredData.filter((s) => s.valid).map((s) => s.type)]);
  const firstSentences = splitSentences(page.textSample).slice(0, 2).join(" ");
  const firstWords = firstSentences.split(/\s+/).filter(Boolean).length;
  const hasLists = /(^|\n)\s*(?:[-•*]|\d+[.)])\s+\S/m.test(page.textSample);
  const signals: AeoSignal[] = [
    { id: "aeo.question_headings", passed: questionHeadings.length >= 1, weight: 15, detail: `${questionHeadings.length} question-style headings`, recommendation: "Phrase key H2/H3 headings as the questions users ask (e.g. “How long does X take?”)." },
    { id: "aeo.concise_answers", passed: conciseAnswers.length >= 1 && conciseAnswers.length >= Math.ceil(questionHeadings.length / 2), weight: 20, detail: `${conciseAnswers.length}/${questionHeadings.length} questions answered in 25–70 words directly below the heading`, recommendation: "Answer each question in a 40–60 word paragraph directly under its heading before elaborating." },
    { id: "aeo.direct_opening", passed: firstWords >= 20 && firstWords <= 80 && !/^(welcome|in this (article|post|guide))/i.test(firstSentences), weight: 10, detail: `${firstWords} words in the opening two sentences`, recommendation: "Open with a direct definition or answer instead of an introduction." },
    { id: "aeo.faq_schema", passed: sdTypes.has("FAQPage") || sdTypes.has("QAPage"), weight: 15, detail: sdTypes.has("FAQPage") || sdTypes.has("QAPage") ? "FAQPage/QAPage schema present" : "no FAQPage/QAPage schema", recommendation: "Add valid FAQPage structured data for the questions answered on the page." },
    { id: "aeo.howto_or_article_schema", passed: ["HowTo", "Article", "NewsArticle", "BlogPosting", "TechArticle"].some((t) => sdTypes.has(t)), weight: 10, detail: `schema types: ${[...sdTypes].join(", ") || "none"}`, recommendation: "Mark up the page as Article/BlogPosting (or HowTo for step content) with author and dates." },
    { id: "aeo.lists_or_steps", passed: hasLists, weight: 10, detail: hasLists ? "list/step formatting detected" : "no lists detected", recommendation: "Use numbered steps or bullet lists for processes and comparisons; answer engines extract them readily." },
    { id: "aeo.heading_hierarchy", passed: page.h1s.length === 1 && page.headingOutline.some((h) => h.level === 2), weight: 5, detail: `${page.h1s.length} H1, ${page.headingOutline.filter((h) => h.level === 2).length} H2`, recommendation: "Use exactly one H1 and structure sections with H2/H3." },
    { id: "aeo.sufficient_depth", passed: page.wordCount >= 500, weight: 5, detail: `${page.wordCount} words`, recommendation: "Cover the topic thoroughly (typically 800+ words) with entities and sub-questions." },
    { id: "aeo.indexable", passed: page.isIndexable, weight: 10, detail: page.isIndexable ? "indexable" : "noindex", recommendation: "The page must be indexable to be cited by search or answer engines." },
  ];
  const total = signals.reduce((n, s) => n + s.weight, 0);
  const got = signals.filter((s) => s.passed).reduce((n, s) => n + s.weight, 0);
  return { score: Math.round((got / total) * 100), signals, questionHeadings, answerCandidates };
}

/** Common llms.txt generator from crawled pages (measured titles/URLs only). */
export function buildLlmsTxt(site: { name: string; domain: string; description?: string | null }, pages: Array<{ url: string; title: string | null; metaDescription: string | null; isIndexable: boolean; depth: number }>, maxLinks = 200): string {
  const lines = [`# ${site.name}`, ""];
  if (site.description) lines.push(`> ${site.description}`, "");
  const usable = pages.filter((p) => p.isIndexable && p.title).sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url)).slice(0, maxLinks);
  lines.push("## Pages", "");
  for (const p of usable) lines.push(`- [${p.title!.replace(/[\[\]]/g, "")}](${p.url})${p.metaDescription ? `: ${p.metaDescription.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
  return lines.join("\n") + "\n";
}

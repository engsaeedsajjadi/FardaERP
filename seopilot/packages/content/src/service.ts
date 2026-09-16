/**
 * AI content assistance (spec §30): briefs, titles, meta, FAQ, improvement,
 * refresh, keyword placement, topic clusters, internal link suggestions.
 * Every output is stored as a content_item with deterministic quality checks
 * and linked to its metered ai_run. Nothing is generated without a configured
 * provider and sufficient credits (runMeteredAi enforces both).
 */
import { and, desc, eq, schema, type Transaction } from "@seopilot/db";
import { parseStructured, runMeteredAi, type AiProvider } from "@seopilot/ai";
import { z } from "zod";
import { checkBody, checkMeta, checkTitle, checkUnique, type QualityCheck } from "./quality";

export type ContentKind = (typeof schema.contentItems.$inferInsert)["kind"];

const SYSTEM = `You are an SEO content strategist. Write for humans first; never keyword-stuff, never invent statistics, quotes, studies, prices or product facts. If information is unknown, say so or leave it out. Match the requested language. Respond ONLY with the JSON object requested.`;

interface Ctx {
  organizationId: string;
  projectId: string;
  userId: string;
  provider: AiProvider;
  language?: string;
  brandName?: string | null;
  idempotencyKey?: string | null;
}

const briefSchema = z.object({
  title: z.string(),
  searchIntent: z.enum(["informational", "commercial", "transactional", "navigational"]),
  targetAudience: z.string(),
  angle: z.string(),
  outline: z.array(z.object({ heading: z.string(), level: z.union([z.literal(2), z.literal(3)]), notes: z.string() })).min(3),
  questionsToAnswer: z.array(z.string()),
  entitiesToCover: z.array(z.string()),
  suggestedWordCount: z.number().int().min(300).max(6000),
  internalLinkIdeas: z.array(z.string()),
});

async function store(tx: Transaction, ctx: Ctx, kind: ContentKind, title: string, targetKeywords: string[], targetUrl: string | null, input: Record<string, unknown>, output: Record<string, unknown>, qualityChecks: QualityCheck[], aiRunId: string) {
  const [row] = await tx.insert(schema.contentItems).values({ projectId: ctx.projectId, organizationId: ctx.organizationId, kind, title, targetUrl, targetKeywords, input, output, qualityChecks, aiRunId, createdBy: ctx.userId }).returning();
  return row!;
}

export async function generateBrief(tx: Transaction, ctx: Ctx, input: { primaryKeyword: string; secondaryKeywords?: string[]; serpTitles?: string[]; peopleAlsoAsk?: string[]; notes?: string }) {
  const secondary = input.secondaryKeywords ?? [];
  const user = `Create a content brief.\nLanguage: ${ctx.language ?? "en"}\nBrand: ${ctx.brandName ?? "(unspecified)"}\nPrimary keyword: ${input.primaryKeyword}\nSecondary keywords: ${secondary.join(", ") || "none"}\n${input.serpTitles?.length ? `Titles currently ranking (do not copy): ${input.serpTitles.slice(0, 10).map((t) => `"${t}"`).join("; ")}\n` : ""}${input.peopleAlsoAsk?.length ? `People also ask: ${input.peopleAlsoAsk.slice(0, 10).join(" | ")}\n` : ""}${input.notes ? `Notes: ${input.notes}\n` : ""}Return JSON: {"title","searchIntent","targetAudience","angle","outline":[{"heading","level":2|3,"notes"}],"questionsToAnswer":[],"entitiesToCover":[],"suggestedWordCount":number,"internalLinkIdeas":[]}`;
  const r = await runMeteredAi(tx, { organizationId: ctx.organizationId, projectId: ctx.projectId, userId: ctx.userId, feature: "content.brief", provider: ctx.provider, request: { system: SYSTEM, messages: [{ role: "user", content: user }], json: true, maxTokens: 2000 }, idempotencyKey: ctx.idempotencyKey });
  const brief = parseStructured(r.text, briefSchema);
  const checks = [...checkTitle(brief.title, [input.primaryKeyword]), { check: "outline.h2_count", passed: brief.outline.filter((o) => o.level === 2).length >= 3, detail: `${brief.outline.filter((o) => o.level === 2).length} H2 sections` }];
  return store(tx, ctx, "brief", brief.title, [input.primaryKeyword, ...secondary], null, input, brief, checks, r.aiRunId);
}

const titlesSchema = z.object({ titles: z.array(z.string()).min(3).max(10) });
export async function generateTitles(tx: Transaction, ctx: Ctx, input: { keyword: string; topic?: string; currentTitle?: string | null; targetUrl?: string | null }) {
  const user = `Suggest 5 SEO page titles (30–60 characters each) for the keyword "${input.keyword}"${input.topic ? ` about: ${input.topic}` : ""}${input.currentTitle ? `. Current title: "${input.currentTitle}" (improve on it)` : ""}. Language: ${ctx.language ?? "en"}. Return JSON {"titles":[...]}`;
  const r = await runMeteredAi(tx, { organizationId: ctx.organizationId, projectId: ctx.projectId, userId: ctx.userId, feature: "content.titles", provider: ctx.provider, request: { system: SYSTEM, messages: [{ role: "user", content: user }], json: true, maxTokens: 500 }, idempotencyKey: ctx.idempotencyKey });
  const out = parseStructured(r.text, titlesSchema);
  const checks = out.titles.flatMap((t, i) => checkTitle(t, [input.keyword]).map((c) => ({ ...c, check: `${i + 1}.${c.check}` })));
  return store(tx, ctx, "titles", `Titles for "${input.keyword}"`, [input.keyword], input.targetUrl ?? null, input, out, checks, r.aiRunId);
}

const metaSchema = z.object({ title: z.string(), metaDescription: z.string() });
export async function generateMeta(tx: Transaction, ctx: Ctx, input: { targetUrl: string; keyword: string; pageSummary: string; currentTitle?: string | null; currentMeta?: string | null }) {
  const user = `Write an SEO title (30–60 chars) and meta description (70–155 chars) for ${input.targetUrl}.\nTarget keyword: ${input.keyword}\nPage summary: ${input.pageSummary.slice(0, 1500)}\n${input.currentTitle ? `Current title: ${input.currentTitle}\n` : ""}${input.currentMeta ? `Current meta: ${input.currentMeta}\n` : ""}Language: ${ctx.language ?? "en"}. Return JSON {"title","metaDescription"}`;
  const r = await runMeteredAi(tx, { organizationId: ctx.organizationId, projectId: ctx.projectId, userId: ctx.userId, feature: "content.meta", provider: ctx.provider, request: { system: SYSTEM, messages: [{ role: "user", content: user }], json: true, maxTokens: 300 }, idempotencyKey: ctx.idempotencyKey });
  const out = parseStructured(r.text, metaSchema);
  return store(tx, ctx, "meta", out.title, [input.keyword], input.targetUrl, input, out, [...checkTitle(out.title, [input.keyword]), ...checkMeta(out.metaDescription, [input.keyword])], r.aiRunId);
}

const faqSchema = z.object({ faqs: z.array(z.object({ question: z.string(), answer: z.string() })).min(3).max(12) });
export async function generateFaq(tx: Transaction, ctx: Ctx, input: { topic: string; keyword: string; pageText?: string; peopleAlsoAsk?: string[]; targetUrl?: string | null }) {
  const user = `Write 5–8 FAQ pairs for a page about "${input.topic}" (keyword: ${input.keyword}). Answers must be 40–80 words, direct, factual, and only use information in the page text below — do not invent facts.${input.peopleAlsoAsk?.length ? ` Prefer these real user questions: ${input.peopleAlsoAsk.slice(0, 10).join(" | ")}.` : ""}\nPage text:\n${(input.pageText ?? "").slice(0, 4000)}\nLanguage: ${ctx.language ?? "en"}. Return JSON {"faqs":[{"question","answer"}]}`;
  const r = await runMeteredAi(tx, { organizationId: ctx.organizationId, projectId: ctx.projectId, userId: ctx.userId, feature: "content.faq", provider: ctx.provider, request: { system: SYSTEM, messages: [{ role: "user", content: user }], json: true, maxTokens: 1500 }, idempotencyKey: ctx.idempotencyKey });
  const out = parseStructured(r.text, faqSchema);
  const checks: QualityCheck[] = out.faqs.map((f, i) => { const w = f.answer.split(/\s+/).length; return { check: `${i + 1}.answer_length`, passed: w >= 25 && w <= 110, detail: `${w} words` }; });
  const jsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: out.faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) };
  return store(tx, ctx, "faq", `FAQ: ${input.topic}`, [input.keyword], input.targetUrl ?? null, input, { ...out, jsonLd }, checks, r.aiRunId);
}

const improveSchema = z.object({ summary: z.string(), issues: z.array(z.object({ issue: z.string(), why: z.string(), fix: z.string(), priority: z.enum(["high", "medium", "low"]) })).min(1), missingSubtopics: z.array(z.string()), rewriteSuggestions: z.array(z.object({ original: z.string(), improved: z.string() })).max(5) });
export async function suggestImprovements(tx: Transaction, ctx: Ctx, input: { targetUrl: string; keyword: string; pageText: string; headings?: string[]; competitorHeadings?: string[]; kind?: "improvement" | "refresh" }) {
  const user = `Review this page for the keyword "${input.keyword}" and suggest ${input.kind === "refresh" ? "a content refresh (outdated sections, missing coverage, decay signals)" : "improvements"}. Base every point on the text given; do not invent facts.\nURL: ${input.targetUrl}\nHeadings: ${(input.headings ?? []).join(" | ")}\n${input.competitorHeadings?.length ? `Competitor headings for the same query: ${input.competitorHeadings.slice(0, 40).join(" | ")}\n` : ""}Page text:\n${input.pageText.slice(0, 6000)}\nLanguage: ${ctx.language ?? "en"}. Return JSON {"summary","issues":[{"issue","why","fix","priority":"high|medium|low"}],"missingSubtopics":[],"rewriteSuggestions":[{"original","improved"}]}`;
  const r = await runMeteredAi(tx, { organizationId: ctx.organizationId, projectId: ctx.projectId, userId: ctx.userId, feature: `content.${input.kind ?? "improvement"}`, provider: ctx.provider, request: { system: SYSTEM, messages: [{ role: "user", content: user }], json: true, maxTokens: 2500 }, idempotencyKey: ctx.idempotencyKey });
  const out = parseStructured(r.text, improveSchema);
  const body = checkBody(input.pageText, [input.keyword]);
  return store(tx, ctx, input.kind ?? "improvement", `${input.kind === "refresh" ? "Refresh" : "Improve"}: ${input.targetUrl}`, [input.keyword], input.targetUrl, { ...input, pageText: undefined }, out, body, r.aiRunId);
}

const placementSchema = z.object({ placements: z.array(z.object({ keyword: z.string(), where: z.string(), suggestion: z.string() })) });
export async function suggestKeywordPlacement(tx: Transaction, ctx: Ctx, input: { targetUrl: string; keywords: string[]; pageText: string; title: string | null; h1: string | null }) {
  const user = `For the page below, suggest natural placements for these keywords: ${input.keywords.join(", ")}. Consider title, H1, first paragraph, subheadings, image alt and closing. Never suggest stuffing (max ~2% density). Title: ${input.title ?? "(none)"} H1: ${input.h1 ?? "(none)"}\nText:\n${input.pageText.slice(0, 5000)}\nReturn JSON {"placements":[{"keyword","where","suggestion"}]}`;
  const r = await runMeteredAi(tx, { organizationId: ctx.organizationId, projectId: ctx.projectId, userId: ctx.userId, feature: "content.keyword_placement", provider: ctx.provider, request: { system: SYSTEM, messages: [{ role: "user", content: user }], json: true, maxTokens: 1500 }, idempotencyKey: ctx.idempotencyKey });
  const out = parseStructured(r.text, placementSchema);
  return store(tx, ctx, "keyword_placement", `Keyword placement: ${input.targetUrl}`, input.keywords, input.targetUrl, { ...input, pageText: undefined }, out, checkBody(input.pageText, input.keywords), r.aiRunId);
}

const topicsSchema = z.object({ clusters: z.array(z.object({ pillar: z.string(), intent: z.string(), supporting: z.array(z.object({ topic: z.string(), keywords: z.array(z.string()) })).min(1) })).min(1) });
export async function suggestTopicClusters(tx: Transaction, ctx: Ctx, input: { seedKeywords: string[]; existingTitles?: string[]; niche?: string }) {
  const user = `Group these keywords into pillar/cluster topics for ${input.niche ?? "this site"}: ${input.seedKeywords.slice(0, 200).join(", ")}.${input.existingTitles?.length ? ` Existing pages (avoid duplicating): ${input.existingTitles.slice(0, 50).join(" | ")}.` : ""} Only use the provided keywords. Return JSON {"clusters":[{"pillar","intent","supporting":[{"topic","keywords":[]}]}]}`;
  const r = await runMeteredAi(tx, { organizationId: ctx.organizationId, projectId: ctx.projectId, userId: ctx.userId, feature: "content.topics", provider: ctx.provider, request: { system: SYSTEM, messages: [{ role: "user", content: user }], json: true, maxTokens: 3000 }, idempotencyKey: ctx.idempotencyKey });
  const out = parseStructured(r.text, topicsSchema);
  const provided = new Set(input.seedKeywords.map((k) => k.toLowerCase().trim()));
  const used = out.clusters.flatMap((c) => c.supporting.flatMap((s) => s.keywords));
  const invented = used.filter((k) => !provided.has(k.toLowerCase().trim()));
  const checks: QualityCheck[] = [{ check: "topics.only_provided_keywords", passed: invented.length === 0, detail: invented.length ? `${invented.length} keywords not in input: ${invented.slice(0, 5).join(", ")}` : "all keywords from input" }];
  return store(tx, ctx, "topics", `Topic clusters (${input.seedKeywords.length} keywords)`, input.seedKeywords.slice(0, 50), null, input, out, checks, r.aiRunId);
}

/**
 * Internal link suggestions are computed deterministically from crawl data
 * (anchor/keyword overlap), not by the model — the model would hallucinate URLs.
 */
export function internalLinkSuggestions(pages: Array<{ url: string; title: string | null; h1s: string[]; textSample: string; links: string[] }>, opts: { minScore?: number; maxPerPage?: number } = {}) {
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9\u00c0-\u024f]+/).filter((w) => w.length > 3));
  const profile = pages.map((p) => ({ url: p.url, terms: tokens(`${p.title ?? ""} ${p.h1s.join(" ")}`), body: tokens(p.textSample), outgoing: new Set(p.links) }));
  const out: Array<{ fromUrl: string; toUrl: string; score: number; matchedTerms: string[] }> = [];
  for (const from of profile) {
    const candidates: typeof out = [];
    for (const to of profile) {
      if (to.url === from.url || from.outgoing.has(to.url) || to.terms.size === 0) continue;
      const matched = [...to.terms].filter((t) => from.body.has(t));
      const score = matched.length / to.terms.size;
      if (score >= (opts.minScore ?? 0.5) && matched.length >= 2) candidates.push({ fromUrl: from.url, toUrl: to.url, score: Number(score.toFixed(2)), matchedTerms: matched.slice(0, 8) });
    }
    candidates.sort((a, b) => b.score - a.score);
    out.push(...candidates.slice(0, opts.maxPerPage ?? 5));
  }
  return out;
}

export async function listContentItems(tx: Transaction, projectId: string, kind?: ContentKind, limit = 50) {
  const where = kind ? and(eq(schema.contentItems.projectId, projectId), eq(schema.contentItems.kind, kind)) : eq(schema.contentItems.projectId, projectId);
  return tx.select().from(schema.contentItems).where(where).orderBy(desc(schema.contentItems.createdAt)).limit(limit);
}

export { checkUnique };

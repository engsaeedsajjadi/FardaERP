/** SERP feature helpers shared by rankings, AEO and reports. */
export const SERP_FEATURE_LABELS: Record<string, string> = {
  organic: "Organic",
  paid: "Ads",
  featured_snippet: "Featured snippet",
  people_also_ask: "People also ask",
  local_pack: "Local pack",
  knowledge_graph: "Knowledge panel",
  images: "Images",
  video: "Video",
  shopping: "Shopping",
  top_stories: "Top stories",
  ai_overview: "AI Overview",
  related_searches: "Related searches",
  answer_box: "Answer box",
  twitter: "X (Twitter)",
  carousel: "Carousel",
  faq: "FAQ",
  discussions_and_forums: "Discussions and forums",
};

export function labelFeature(type: string): string {
  return SERP_FEATURE_LABELS[type] ?? type.replace(/_/g, " ");
}

/** Features that indicate an answer-engine opportunity (AEO). */
export const AEO_FEATURES = new Set(["featured_snippet", "people_also_ask", "answer_box", "ai_overview", "faq"]);

export function aeoOpportunity(features: string[], position: number | null): { opportunity: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const f of features) if (AEO_FEATURES.has(f)) reasons.push(labelFeature(f));
  const opportunity = reasons.length > 0 && position !== null && position <= 10;
  return { opportunity, reasons };
}

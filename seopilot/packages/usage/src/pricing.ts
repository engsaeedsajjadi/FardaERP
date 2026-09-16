/**
 * Credit price list. One credit is the internal unit sold in plans; every
 * metered operation has a fixed credit cost so customers can predict spend.
 * The provider's real USD cost is recorded alongside each transaction for
 * margin analysis — it never changes what the customer is charged.
 */
export const CREDIT_COSTS = {
  "serp.check": 1, // one live SERP (rank check for one keyword/device/location)
  "keyword.metrics": 1, // per 10 keywords (rounded up)
  "keyword.ideas": 5, // one research call (related / suggestions / ideas / site keywords)
  "competitor.overview": 3,
  "competitor.ranked_keywords": 10,
  "competitor.serp_competitors": 5,
  "backlinks.summary": 5,
  "backlinks.list": 10, // per 1000 rows
  "backlinks.anchors": 5,
  "backlinks.referring_domains": 5,
  "crawl.page": 0, // crawl pages count against plan limits, not credits
  "pagespeed.run": 0, // Google PSI is free; plan-limited
  "ai.tokens": 1, // per 1000 tokens (in+out)
  "ai.visibility.prompt": 2,
  "report.pdf": 0,
} as const;

export type MeteredOperation = keyof typeof CREDIT_COSTS;

export function creditsFor(op: MeteredOperation, quantity = 1): number {
  const unit = CREDIT_COSTS[op];
  switch (op) {
    case "keyword.metrics":
      return Math.ceil(quantity / 10) * unit;
    case "backlinks.list":
      return Math.ceil(quantity / 1000) * unit;
    case "ai.tokens":
      return Math.ceil(quantity / 1000) * unit;
    default:
      return unit * quantity;
  }
}

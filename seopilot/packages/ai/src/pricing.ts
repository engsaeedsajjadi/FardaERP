/**
 * Published list prices in USD per 1M tokens (input, output), used ONLY to
 * estimate provider cost for margin reporting. Customers are charged credits
 * (usage/pricing.ts), never this figure. Unknown models yield null — we do not
 * guess. Override/extend at deploy time with AI_MODEL_PRICES_JSON
 * ({"provider/model":[in,out]}).
 */
export const AI_MODEL_PRICES_AS_OF = "2026-09";

const BUILTIN: Record<string, [number, number]> = {
  "openai/gpt-4o-mini": [0.15, 0.6],
  "openai/gpt-4o": [2.5, 10],
  "openai/gpt-4.1-mini": [0.4, 1.6],
  "openai/gpt-4.1": [2, 8],
  "openai/gpt-5-mini": [0.25, 2],
  "openai/gpt-5": [1.25, 10],
  "anthropic/claude-3-5-haiku-latest": [0.8, 4],
  "anthropic/claude-sonnet-4-20250514": [3, 15],
  "anthropic/claude-sonnet-4-5": [3, 15],
  "anthropic/claude-haiku-4-5": [1, 5],
  "google/gemini-2.0-flash": [0.1, 0.4],
  "google/gemini-2.5-flash": [0.3, 2.5],
  "google/gemini-2.5-pro": [1.25, 10],
  "perplexity/sonar": [1, 1],
  "perplexity/sonar-pro": [3, 15],
};

let overrides: Record<string, [number, number]> | null = null;
function table(env: NodeJS.ProcessEnv): Record<string, [number, number]> {
  if (overrides === null) {
    overrides = {};
    const raw = env.AI_MODEL_PRICES_JSON;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, [number, number]>;
        for (const [k, v] of Object.entries(parsed)) if (Array.isArray(v) && v.length === 2) overrides[k] = [Number(v[0]), Number(v[1])];
      } catch {
        /* invalid JSON → ignore overrides, keep builtin */
      }
    }
  }
  return { ...BUILTIN, ...overrides };
}

export function resetPriceCache(): void {
  overrides = null;
}

export function estimateCostUsd(provider: string, model: string, inputTokens: number, outputTokens: number, env: NodeJS.ProcessEnv = process.env): number | null {
  const t = table(env);
  const price = t[`${provider}/${model}`] ?? t[`${provider}/${model.replace(/-\d{8}$/, "")}`];
  if (!price) return null;
  return Number(((inputTokens * price[0] + outputTokens * price[1]) / 1_000_000).toFixed(6));
}

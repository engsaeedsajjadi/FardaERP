import { AppError } from "@seopilot/shared";
import { anthropicProvider } from "./providers/anthropic";
import { googleAiProvider } from "./providers/google";
import { openAiCompatible } from "./providers/openai-compatible";
import type { AiProvider, AiProviderName, FetchLike } from "./types";

export const AI_PROVIDER_ORDER: AiProviderName[] = ["openai", "anthropic", "google", "openrouter", "perplexity"];

export function buildAiProviders(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): Map<AiProviderName, AiProvider> {
  const m = new Map<AiProviderName, AiProvider>();
  if (env.OPENAI_API_KEY) m.set("openai", openAiCompatible({ name: "openai", apiKey: env.OPENAI_API_KEY, baseUrl: "https://api.openai.com/v1", defaultModel: env.OPENAI_MODEL ?? "gpt-4.1-mini", supportsWebSearch: false, fetchImpl }));
  if (env.ANTHROPIC_API_KEY) m.set("anthropic", anthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5", fetchImpl));
  if (env.GOOGLE_AI_API_KEY) m.set("google", googleAiProvider(env.GOOGLE_AI_API_KEY, env.GOOGLE_AI_MODEL ?? "gemini-2.5-flash", fetchImpl));
  if (env.OPENROUTER_API_KEY) m.set("openrouter", openAiCompatible({ name: "openrouter", apiKey: env.OPENROUTER_API_KEY, baseUrl: "https://openrouter.ai/api/v1", defaultModel: env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini", supportsWebSearch: false, extraHeaders: { "HTTP-Referer": env.APP_URL ?? "https://seopilot.local", "X-Title": "SEOPilot" }, fetchImpl }));
  if (env.PERPLEXITY_API_KEY) m.set("perplexity", openAiCompatible({ name: "perplexity", apiKey: env.PERPLEXITY_API_KEY, baseUrl: "https://api.perplexity.ai", defaultModel: env.PERPLEXITY_MODEL ?? "sonar", supportsWebSearch: true, fetchImpl }));
  return m;
}

export function configuredAiProviders(env: NodeJS.ProcessEnv = process.env): AiProviderName[] {
  return AI_PROVIDER_ORDER.filter((n) => buildAiProviders(env).has(n));
}

/** Pick a provider: explicit name, else the first configured in preference order. */
export function requireAiProvider(providers: Map<AiProviderName, AiProvider>, name?: AiProviderName | null, opts: { webSearch?: boolean } = {}): AiProvider {
  if (name) {
    const p = providers.get(name);
    if (!p) throw new AppError("PROVIDER_NOT_CONFIGURED", `AI provider "${name}" is not configured`, { provider: name }, { reportable: false });
    if (opts.webSearch && !p.supportsWebSearch) throw new AppError("VALIDATION_ERROR", `AI provider "${name}" does not support web search`, { provider: name });
    return p;
  }
  for (const n of AI_PROVIDER_ORDER) {
    const p = providers.get(n);
    if (p && (!opts.webSearch || p.supportsWebSearch)) return p;
  }
  throw new AppError("PROVIDER_NOT_CONFIGURED", opts.webSearch ? "No AI provider with web search is configured (Perplexity or Google AI)" : "No AI provider is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY, OPENROUTER_API_KEY or PERPLEXITY_API_KEY.", { provider: "ai" }, { reportable: false });
}

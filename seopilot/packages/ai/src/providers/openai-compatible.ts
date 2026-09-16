/** OpenAI Chat Completions — also used for OpenRouter and Perplexity (OpenAI-compatible APIs). */
import { AppError } from "@seopilot/shared";
import type { AiProvider, AiProviderName, AiRequest, AiResponse, FetchLike } from "../types";

interface Opts {
  name: AiProviderName;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  supportsWebSearch: boolean;
  extraHeaders?: Record<string, string>;
  fetchImpl?: FetchLike;
}

export function mapHttpError(status: number, message: string, provider: string): AppError {
  if (status === 401 || status === 403) return new AppError("PROVIDER_AUTH_FAILED", `${provider}: ${message}`, { provider }, { reportable: false });
  if (status === 429) return new AppError("RATE_LIMITED", `${provider}: rate limited`, { provider }, { reportable: false });
  if (status >= 500) return new AppError("UPSTREAM_UNAVAILABLE", `${provider}: ${message}`, { provider }, { reportable: false });
  return new AppError("PROVIDER_ERROR", `${provider}: ${message}`, { provider, status });
}

export function openAiCompatible(o: Opts): AiProvider {
  const fetchImpl = o.fetchImpl ?? fetch;
  return {
    name: o.name,
    defaultModel: o.defaultModel,
    supportsWebSearch: o.supportsWebSearch,
    async complete(req: AiRequest): Promise<AiResponse> {
      const messages = [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages.map((m) => ({ role: m.role, content: m.content }))];
      const body: Record<string, unknown> = { model: req.model, messages, max_tokens: req.maxTokens ?? 1024, temperature: req.temperature ?? 0.2 };
      if (req.json && o.name !== "perplexity") body["response_format"] = { type: "json_object" };
      const res = await fetchImpl(`${o.baseUrl}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json", ...o.extraHeaders }, body: JSON.stringify(body), signal: req.signal });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const err = json["error"] as { message?: string } | undefined;
        throw mapHttpError(res.status, err?.message ?? `HTTP ${res.status}`, o.name);
      }
      const choice = (json["choices"] as Array<{ message?: { content?: string | null }; finish_reason?: string }> | undefined)?.[0];
      const usage = (json["usage"] ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
      const citations = Array.isArray(json["citations"]) ? (json["citations"] as unknown[]).filter((c): c is string => typeof c === "string") : [];
      return { text: choice?.message?.content ?? "", inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0, requestId: typeof json["id"] === "string" ? (json["id"] as string) : res.headers.get("x-request-id"), finishReason: choice?.finish_reason ?? null, citations, model: typeof json["model"] === "string" ? (json["model"] as string) : req.model };
    },
  };
}

import type { AiProvider, AiRequest, AiResponse, FetchLike } from "../types";
import { mapHttpError } from "./openai-compatible";

export function anthropicProvider(apiKey: string, defaultModel = "claude-sonnet-4-5", fetchImpl: FetchLike = fetch): AiProvider {
  return {
    name: "anthropic",
    defaultModel,
    supportsWebSearch: false,
    async complete(req: AiRequest): Promise<AiResponse> {
      const system = req.json ? `${req.system ?? ""}\n\nRespond with a single valid JSON object and nothing else.`.trim() : req.system;
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: req.model, system, messages: req.messages, max_tokens: req.maxTokens ?? 1024, temperature: req.temperature ?? 0.2 }),
        signal: req.signal,
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw mapHttpError(res.status, (json["error"] as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`, "anthropic");
      const content = (json["content"] as Array<{ type: string; text?: string }> | undefined) ?? [];
      const usage = (json["usage"] ?? {}) as { input_tokens?: number; output_tokens?: number };
      return { text: content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""), inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, requestId: res.headers.get("request-id") ?? (typeof json["id"] === "string" ? (json["id"] as string) : null), finishReason: typeof json["stop_reason"] === "string" ? (json["stop_reason"] as string) : null, citations: [], model: typeof json["model"] === "string" ? (json["model"] as string) : req.model };
    },
  };
}

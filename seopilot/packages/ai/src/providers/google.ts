import type { AiProvider, AiRequest, AiResponse, FetchLike } from "../types";
import { mapHttpError } from "./openai-compatible";

export function googleAiProvider(apiKey: string, defaultModel = "gemini-2.5-flash", fetchImpl: FetchLike = fetch): AiProvider {
  return {
    name: "google",
    defaultModel,
    supportsWebSearch: true,
    async complete(req: AiRequest): Promise<AiResponse> {
      const body: Record<string, unknown> = {
        contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: req.maxTokens ?? 1024, temperature: req.temperature ?? 0.2, ...(req.json && !req.webSearch ? { responseMimeType: "application/json" } : {}) },
      };
      if (req.system) body["systemInstruction"] = { parts: [{ text: req.system }] };
      if (req.webSearch) body["tools"] = [{ google_search: {} }];
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`, { method: "POST", headers: { "x-goog-api-key": apiKey, "content-type": "application/json" }, body: JSON.stringify(body), signal: req.signal });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw mapHttpError(res.status, (json["error"] as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`, "google");
      const cand = (json["candidates"] as Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string; groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> } }> | undefined)?.[0];
      const usage = (json["usageMetadata"] ?? {}) as { promptTokenCount?: number; candidatesTokenCount?: number };
      const citations = (cand?.groundingMetadata?.groundingChunks ?? []).map((c) => c.web?.uri).filter((u): u is string => typeof u === "string");
      return { text: (cand?.content?.parts ?? []).map((p) => p.text ?? "").join(""), inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0, requestId: typeof json["responseId"] === "string" ? (json["responseId"] as string) : null, finishReason: cand?.finishReason ?? null, citations, model: typeof json["modelVersion"] === "string" ? (json["modelVersion"] as string) : req.model };
    },
  };
}

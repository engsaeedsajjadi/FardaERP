import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, parseStructured } from "./json";
import { estimateCostUsd, resetPriceCache } from "./pricing";
import { anthropicProvider } from "./providers/anthropic";
import { googleAiProvider } from "./providers/google";
import { openAiCompatible } from "./providers/openai-compatible";
import { buildAiProviders, configuredAiProviders, requireAiProvider } from "./registry";

const fake = (body: unknown, status = 200) => {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const f = (async (u: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(u), body: JSON.parse(String(init?.body ?? "{}")), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
    return new Response(JSON.stringify(body), { status, headers: { "x-request-id": "rq1" } });
  }) as typeof fetch;
  return { f, calls };
};

describe("json extraction", () => {
  it("parses raw, fenced and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Sure!\n```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('Here you go: {"t":"x"} hope it helps')).toEqual({ t: "x" });
    expect(() => extractJson("no json here")).toThrowError(/not valid JSON/);
  });
  it("validates against a schema with a typed error", () => {
    expect(parseStructured('{"titles":["a"]}', z.object({ titles: z.array(z.string()) }))).toEqual({ titles: ["a"] });
    expect(() => parseStructured('{"titles":"a"}', z.object({ titles: z.array(z.string()) }))).toThrowError(/expected structure/);
  });
});

describe("pricing", () => {
  it("estimates from the built-in table and returns null for unknown models", () => {
    resetPriceCache();
    expect(estimateCostUsd("openai", "gpt-4o-mini", 1_000_000, 0, {} as NodeJS.ProcessEnv)).toBe(0.15);
    expect(estimateCostUsd("openai", "made-up-model", 1000, 1000, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(estimateCostUsd("anthropic", "claude-sonnet-4-20250514", 0, 1_000_000, {} as NodeJS.ProcessEnv)).toBe(15);
  });
  it("accepts deploy-time overrides", () => {
    resetPriceCache();
    expect(estimateCostUsd("openai", "custom", 2_000_000, 0, { AI_MODEL_PRICES_JSON: '{"openai/custom":[1,2]}' } as NodeJS.ProcessEnv)).toBe(2);
    resetPriceCache();
  });
});

describe("registry", () => {
  it("only builds providers with keys and fails closed when none configured", () => {
    expect(configuredAiProviders({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(() => requireAiProvider(buildAiProviders({} as NodeJS.ProcessEnv))).toThrowError(/No AI provider is configured/);
    const m = buildAiProviders({ ANTHROPIC_API_KEY: "k", PERPLEXITY_API_KEY: "p" } as NodeJS.ProcessEnv);
    expect([...m.keys()]).toEqual(["anthropic", "perplexity"]);
    expect(requireAiProvider(m).name).toBe("anthropic");
    expect(requireAiProvider(m, null, { webSearch: true }).name).toBe("perplexity");
    expect(() => requireAiProvider(m, "openai")).toThrowError(/not configured/);
  });
});

describe("providers", () => {
  it("openai-compatible: sends messages, requests JSON mode, maps usage + errors", async () => {
    const { f, calls } = fake({ id: "cmpl-1", model: "gpt-4.1-mini-2025", choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 5 } });
    const p = openAiCompatible({ name: "openai", apiKey: "sk", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini", supportsWebSearch: false, fetchImpl: f });
    const r = await p.complete({ model: "gpt-4.1-mini", system: "sys", messages: [{ role: "user", content: "hi" }], json: true });
    expect(r).toMatchObject({ text: '{"ok":true}', inputTokens: 12, outputTokens: 5, requestId: "cmpl-1", model: "gpt-4.1-mini-2025", citations: [] });
    expect(calls[0]!.body["messages"]).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "hi" }]);
    expect(calls[0]!.body["response_format"]).toEqual({ type: "json_object" });
    expect(calls[0]!.headers["authorization"]).toBe("Bearer sk");
    const bad = fake({ error: { message: "invalid key" } }, 401);
    await expect(openAiCompatible({ name: "openai", apiKey: "x", baseUrl: "u", defaultModel: "m", supportsWebSearch: false, fetchImpl: bad.f }).complete({ model: "m", messages: [] })).rejects.toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
    const limited = fake({}, 429);
    await expect(openAiCompatible({ name: "openai", apiKey: "x", baseUrl: "u", defaultModel: "m", supportsWebSearch: false, fetchImpl: limited.f }).complete({ model: "m", messages: [] })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  it("perplexity: passes through citations and never sets response_format", async () => {
    const { f, calls } = fake({ choices: [{ message: { content: "Answer [1]" } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, citations: ["https://a.example/x", "https://b.example/y"] });
    const p = openAiCompatible({ name: "perplexity", apiKey: "k", baseUrl: "https://api.perplexity.ai", defaultModel: "sonar", supportsWebSearch: true, fetchImpl: f });
    const r = await p.complete({ model: "sonar", messages: [{ role: "user", content: "q" }], json: true });
    expect(r.citations).toEqual(["https://a.example/x", "https://b.example/y"]);
    expect(calls[0]!.body["response_format"]).toBeUndefined();
  });
  it("anthropic: uses the messages API shape and joins text blocks", async () => {
    const { f, calls } = fake({ id: "msg_1", model: "claude-sonnet-4-5", content: [{ type: "text", text: "Hel" }, { type: "text", text: "lo" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } });
    const r = await anthropicProvider("ak", "claude-sonnet-4-5", f).complete({ model: "claude-sonnet-4-5", system: "s", messages: [{ role: "user", content: "x" }], json: true });
    expect(r).toMatchObject({ text: "Hello", inputTokens: 3, outputTokens: 2, finishReason: "end_turn" });
    expect(calls[0]!.headers["x-api-key"]).toBe("ak");
    expect(String(calls[0]!.body["system"])).toContain("valid JSON object");
  });
  it("google: maps roles, grounding citations and usage", async () => {
    const { f, calls } = fake({ responseId: "r1", modelVersion: "gemini-2.5-flash-001", candidates: [{ content: { parts: [{ text: "A" }, { text: "B" }] }, finishReason: "STOP", groundingMetadata: { groundingChunks: [{ web: { uri: "https://src.example/p" } }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 } });
    const r = await googleAiProvider("gk", "gemini-2.5-flash", f).complete({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "q" }, { role: "assistant", content: "a" }], webSearch: true });
    expect(r).toMatchObject({ text: "AB", inputTokens: 7, outputTokens: 4, citations: ["https://src.example/p"], requestId: "r1" });
    expect((calls[0]!.body["contents"] as Array<{ role: string }>).map((c) => c.role)).toEqual(["user", "model"]);
    expect(calls[0]!.body["tools"]).toEqual([{ google_search: {} }]);
    expect(calls[0]!.url).toContain("models/gemini-2.5-flash:generateContent");
  });
});

export type AiProviderName = "openai" | "anthropic" | "google" | "openrouter" | "perplexity";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiRequest {
  model: string;
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider for a JSON object response where supported. */
  json?: boolean;
  /** Enable provider-side web search/grounding where supported (Perplexity, Google). */
  webSearch?: boolean;
  signal?: AbortSignal;
}

export interface AiResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  requestId: string | null;
  finishReason: string | null;
  /** URLs the provider reports as sources (Perplexity/Google grounding); [] when unsupported. */
  citations: string[];
  model: string;
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly defaultModel: string;
  readonly supportsWebSearch: boolean;
  complete(req: AiRequest): Promise<AiResponse>;
}

export type FetchLike = typeof fetch;

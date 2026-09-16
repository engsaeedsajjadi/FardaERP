/**
 * Minimal, honest DataForSEO v3 HTTP client.
 *
 * Design (patterns adapted from open-seo, MIT © 2026 Ben Senescu — rewritten):
 *  - one authenticated POST helper with a shared wall-clock budget and bounded
 *    retries on transient 5xx only (never on timeouts: the task may be billed);
 *  - task-level failures arrive on HTTP 200, so every response goes through
 *    `assertTask` which distinguishes "no results" (billed, empty), provider
 *    backend failures, auth/balance failures and malformed requests;
 *  - every successful call returns the provider-reported `cost` and task id so
 *    the metering layer never has to guess.
 */
import { AppError } from "@seopilot/shared";
import type { ProviderCost } from "../types";

export const DATAFORSEO_API_BASE = "https://api.dataforseo.com";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_5XX_RETRIES = 2;
const RETRY_BACKOFF_MS = 250;
const MAX_ERROR_BODY = 1500;

export interface DataForSeoCredentials {
  login: string;
  password: string;
}

export interface DataForSeoTask<TResult = unknown> {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  time?: string;
  path?: string[];
  result_count?: number;
  result?: TResult[] | null;
  data?: Record<string, unknown>;
}

export interface DataForSeoResponse<TResult = unknown> {
  version?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks_count?: number;
  tasks_error?: number;
  tasks?: DataForSeoTask<TResult>[];
}

/** DataForSEO backend failures that return HTTP 200 + failed task. Retry-later class. */
const UPSTREAM_TASK_CODES = new Set([40101, 40103, 50000, 50301, 50302, 50303, 50304, 50401, 50402]);
/** Auth / balance / access failures. */
const ACCESS_TASK_CODES = new Set([40100, 40200, 40201, 40202, 40203, 40204, 40209, 40210, 40400, 40401, 40402]);

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class DataForSeoClient {
  private readonly authHeader: string;
  constructor(
    creds: DataForSeoCredentials,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly baseUrl = DATAFORSEO_API_BASE,
  ) {
    this.authHeader = `Basic ${Buffer.from(`${creds.login}:${creds.password}`).toString("base64")}`;
  }

  /** POST a single-task payload and return the validated first task. */
  async postTask<TResult>(path: string, payload: Record<string, unknown>, opts: { treatNoResultsAsEmpty?: boolean } = {}): Promise<{ task: DataForSeoTask<TResult>; cost: ProviderCost }> {
    const response = await this.request<TResult>(path, [payload]);
    const task = assertTask<TResult>(response, path, opts);
    return { task, cost: costOf(task, path) };
  }

  async request<TResult>(path: string, body: unknown): Promise<DataForSeoResponse<TResult>> {
    const url = `${this.baseUrl}${path}`;
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    for (let attempt = 0; ; attempt++) {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.fetchImpl(url, { method: "POST", headers: { authorization: this.authHeader, "content-type": "application/json" }, body: JSON.stringify(body), signal });
      } catch (err) {
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
          throw new AppError("UPSTREAM_UNAVAILABLE", `DataForSEO request timed out on ${path}`, { provider: "dataforseo", endpoint: path }, { reportable: false });
        }
        throw new AppError("UPSTREAM_UNAVAILABLE", `DataForSEO network error on ${path}`, { provider: "dataforseo", endpoint: path }, { cause: err, reportable: false });
      }
      if (res.ok) {
        const text = await res.text();
        try {
          return JSON.parse(text) as DataForSeoResponse<TResult>;
        } catch {
          throw new AppError("PROVIDER_ERROR", `DataForSEO returned non-JSON on ${path}`, { provider: "dataforseo", endpoint: path, body: text.slice(0, MAX_ERROR_BODY) });
        }
      }
      if (res.status >= 500 && attempt < MAX_5XX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
        continue;
      }
      const bodyText = (await res.text()).slice(0, MAX_ERROR_BODY);
      if (res.status === 401) throw new AppError("PROVIDER_AUTH_FAILED", "DataForSEO rejected the credentials", { provider: "dataforseo", endpoint: path }, { reportable: false });
      if (res.status === 402) throw new AppError("PROVIDER_ERROR", "DataForSEO account balance is exhausted", { provider: "dataforseo", endpoint: path, providerStatus: 402 }, { reportable: false });
      if (res.status === 429) throw new AppError("RATE_LIMITED", "DataForSEO rate limit reached", { provider: "dataforseo", endpoint: path }, { reportable: false });
      if (res.status >= 500) throw new AppError("UPSTREAM_UNAVAILABLE", `DataForSEO HTTP ${res.status} on ${path}`, { provider: "dataforseo", endpoint: path }, { reportable: false });
      throw new AppError("PROVIDER_ERROR", `DataForSEO HTTP ${res.status} on ${path}`, { provider: "dataforseo", endpoint: path, providerStatus: res.status, body: bodyText });
    }
  }
}

export function costOf(task: DataForSeoTask, path: string): ProviderCost {
  return { costUsd: typeof task.cost === "number" ? task.cost : null, requestId: task.id ?? null, endpoint: task.path ? `/${task.path.join("/")}` : path };
}

export function isNoResultsTask(task: DataForSeoTask): boolean {
  return task.status_message?.toLowerCase().includes("no search results") ?? false;
}

export function assertTask<TResult>(response: DataForSeoResponse<TResult> | null | undefined, path: string, opts: { treatNoResultsAsEmpty?: boolean } = {}): DataForSeoTask<TResult> {
  const details = { provider: "dataforseo", endpoint: path };
  if (!response) throw new AppError("PROVIDER_ERROR", "DataForSEO returned an empty response", details);
  if (response.status_code !== undefined && response.status_code !== 20000) {
    if (ACCESS_TASK_CODES.has(response.status_code)) throw new AppError("PROVIDER_AUTH_FAILED", `DataForSEO: ${response.status_message ?? response.status_code}`, { ...details, providerStatus: response.status_code }, { reportable: false });
    throw new AppError("PROVIDER_ERROR", `DataForSEO: ${response.status_message ?? response.status_code}`, { ...details, providerStatus: response.status_code });
  }
  const task = response.tasks?.[0];
  if (!task) throw new AppError("PROVIDER_ERROR", "DataForSEO response has no task", details);
  if (task.status_code === 20000) return task;
  if (opts.treatNoResultsAsEmpty !== false && isNoResultsTask(task)) return { ...task, result: [] };
  const msg = `DataForSEO task ${task.status_code ?? "?"}: ${task.status_message ?? "failed"}`;
  const withCode = { ...details, providerStatus: task.status_code, costUsd: task.cost ?? null, taskId: task.id ?? null };
  if (task.status_code !== undefined && ACCESS_TASK_CODES.has(task.status_code)) throw new AppError("PROVIDER_AUTH_FAILED", msg, withCode, { reportable: false });
  if (task.status_code !== undefined && UPSTREAM_TASK_CODES.has(task.status_code)) throw new AppError("UPSTREAM_UNAVAILABLE", msg, withCode, { reportable: false });
  if (/invalid field/i.test(task.status_message ?? "")) {
    const field = task.status_message?.match(/Invalid Field:\s*'([^']+)'/i)?.[1];
    const sent = field && task.data ? task.data[field] : undefined;
    throw new AppError("VALIDATION_ERROR", `${msg}${sent !== undefined ? ` (sent ${field}=${JSON.stringify(sent)})` : ""}`, withCode);
  }
  throw new AppError("PROVIDER_ERROR", msg, withCode);
}

export function firstResult<T>(task: DataForSeoTask<T>): T | null {
  return task.result?.[0] ?? null;
}

export function itemsOf<TItem>(task: DataForSeoTask<{ items?: TItem[] | null }>): TItem[] {
  return task.result?.[0]?.items ?? [];
}

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
export function str(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}
export function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

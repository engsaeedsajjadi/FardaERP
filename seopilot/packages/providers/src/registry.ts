/**
 * Provider registry. Resolution is by environment (operator-level keys) so a
 * self-hosted installation without DataForSEO credentials gets an explicit
 * "not configured" status everywhere instead of fake numbers.
 */
import { notConfigured, providerEnvSchema, readEnv } from "@seopilot/shared";
import { DataForSeoBacklinkProvider } from "./dataforseo/backlinks";
import { DataForSeoClient } from "./dataforseo/client";
import { DataForSeoCompetitorProvider } from "./dataforseo/competitors";
import { DataForSeoKeywordProvider } from "./dataforseo/keywords";
import { DataForSeoSerpProvider } from "./dataforseo/serp";
import type { BacklinkProvider, CompetitorProvider, KeywordDataProvider, ProviderKind, ProviderStatus, SerpProvider } from "./types";

export interface ProviderSet {
  keywords: KeywordDataProvider | null;
  serp: SerpProvider | null;
  competitors: CompetitorProvider | null;
  backlinks: BacklinkProvider | null;
}

let cached: ProviderSet | null = null;

export function buildProviders(env: NodeJS.ProcessEnv = process.env): ProviderSet {
  const e = readEnv(providerEnvSchema, env);
  if (e.DATAFORSEO_LOGIN && e.DATAFORSEO_PASSWORD) {
    const client = new DataForSeoClient({ login: e.DATAFORSEO_LOGIN, password: e.DATAFORSEO_PASSWORD });
    return {
      keywords: new DataForSeoKeywordProvider(client),
      serp: new DataForSeoSerpProvider(client),
      competitors: new DataForSeoCompetitorProvider(client),
      backlinks: new DataForSeoBacklinkProvider(client),
    };
  }
  return { keywords: null, serp: null, competitors: null, backlinks: null };
}

export function getProviders(): ProviderSet {
  if (!cached) cached = buildProviders();
  return cached;
}

/** Test hook. */
export function setProvidersForTesting(set: ProviderSet | null): void {
  cached = set;
}

const REASONS: Record<ProviderKind, string> = {
  keywords: "Keyword data requires DataForSEO credentials (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).",
  serp: "SERP and rank tracking require DataForSEO credentials (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).",
  competitors: "Competitor analysis requires DataForSEO credentials (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).",
  backlinks: "Backlink data requires DataForSEO credentials (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).",
};

export function providerStatus(kind: ProviderKind, set: ProviderSet = getProviders()): ProviderStatus {
  const p = set[kind];
  return { kind, provider: p?.name ?? null, configured: p !== null, reason: p ? null : REASONS[kind] };
}

export function allProviderStatuses(set: ProviderSet = getProviders()): ProviderStatus[] {
  return (["keywords", "serp", "competitors", "backlinks"] as ProviderKind[]).map((k) => providerStatus(k, set));
}

/** Get a provider or throw the standard PROVIDER_NOT_CONFIGURED error (HTTP 424). */
export function requireProvider<K extends ProviderKind>(kind: K, set: ProviderSet = getProviders()): NonNullable<ProviderSet[K]> {
  const p = set[kind];
  if (!p) throw notConfigured(kind === "serp" ? "SERP provider" : kind === "keywords" ? "Keyword data provider" : kind === "backlinks" ? "Backlink provider" : "Competitor data provider");
  return p as NonNullable<ProviderSet[K]>;
}

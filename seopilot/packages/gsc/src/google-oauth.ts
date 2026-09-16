/**
 * Google OAuth for GSC / GA4 connections. Tokens are stored AES-256-GCM
 * encrypted (packages/security crypto) and refreshed on demand. A missing
 * GOOGLE_CLIENT_ID/SECRET yields "not configured" — never a crash.
 */
import { decryptSecret, encryptSecret } from "@seopilot/security";
import { AppError } from "@seopilot/shared";
import { z } from "zod";

const googleEnvSchema = z.object({ GOOGLE_CLIENT_ID: z.string().optional(), GOOGLE_CLIENT_SECRET: z.string().optional() });

export const GOOGLE_SCOPES = {
  gsc: ["https://www.googleapis.com/auth/webmasters.readonly", "openid", "email"],
  ga4: ["https://www.googleapis.com/auth/analytics.readonly", "openid", "email"],
} as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export type FetchLike = typeof fetch;

export function googleOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const e = googleEnvSchema.parse(env);
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}

function creds(env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret: string } {
  const e = googleEnvSchema.parse(env);
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "Google integrations require GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET", { provider: "google" }, { reportable: false });
  }
  return { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET };
}

export function buildAuthorizationUrl(input: { kind: keyof typeof GOOGLE_SCOPES; redirectUri: string; state: string; loginHint?: string }, env?: NodeJS.ProcessEnv): string {
  const { clientId } = creds(env);
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_SCOPES[input.kind].join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent"); // guarantees a refresh token
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", input.state);
  if (input.loginHint) u.searchParams.set("login_hint", input.loginHint);
  return u.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  idToken?: string;
}

async function tokenRequest(body: Record<string, string>, fetchImpl: FetchLike): Promise<TokenSet> {
  const res = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = String(json["error"] ?? res.status);
    if (err === "invalid_grant") throw new AppError("PROVIDER_AUTH_FAILED", "Google authorization was revoked or expired; please reconnect.", { provider: "google", reason: err }, { reportable: false });
    throw new AppError("PROVIDER_ERROR", `Google token endpoint error: ${err}`, { provider: "google", reason: err, description: json["error_description"] });
  }
  const expiresIn = typeof json["expires_in"] === "number" ? json["expires_in"] : 3600;
  return {
    accessToken: String(json["access_token"]),
    refreshToken: typeof json["refresh_token"] === "string" ? json["refresh_token"] : null,
    expiresAt: new Date(Date.now() + (expiresIn - 60) * 1000),
    scopes: typeof json["scope"] === "string" ? json["scope"].split(" ") : [],
    idToken: typeof json["id_token"] === "string" ? json["id_token"] : undefined,
  };
}

export async function exchangeCode(input: { code: string; redirectUri: string }, fetchImpl: FetchLike = fetch, env?: NodeJS.ProcessEnv): Promise<TokenSet & { email: string | null }> {
  const { clientId, clientSecret } = creds(env);
  const tokens = await tokenRequest({ code: input.code, client_id: clientId, client_secret: clientSecret, redirect_uri: input.redirectUri, grant_type: "authorization_code" }, fetchImpl);
  if (!tokens.refreshToken) throw new AppError("PROVIDER_ERROR", "Google did not return a refresh token; remove SEOPilot from your Google account permissions and connect again.", { provider: "google" }, { reportable: false });
  let email: string | null = null;
  try {
    const ui = await fetchImpl(USERINFO_URL, { headers: { authorization: `Bearer ${tokens.accessToken}` } });
    if (ui.ok) email = ((await ui.json()) as { email?: string }).email ?? null;
  } catch {
    /* email is informational */
  }
  return { ...tokens, email };
}

export async function refreshAccessToken(refreshToken: string, fetchImpl: FetchLike = fetch, env?: NodeJS.ProcessEnv): Promise<TokenSet> {
  const { clientId, clientSecret } = creds(env);
  const t = await tokenRequest({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }, fetchImpl);
  return { ...t, refreshToken };
}

export async function revokeToken(token: string, fetchImpl: FetchLike = fetch): Promise<void> {
  await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
}

/** Stored connection fields (both GSC and GA4 connections share this shape). */
export interface StoredTokens {
  encryptedRefreshToken: string;
  encryptedAccessToken: string | null;
  accessTokenExpiresAt: Date | null;
}

export function encryptTokens(t: { refreshToken: string; accessToken: string; expiresAt: Date }, aad: string): StoredTokens {
  return { encryptedRefreshToken: encryptSecret(t.refreshToken, aad), encryptedAccessToken: encryptSecret(t.accessToken, aad), accessTokenExpiresAt: t.expiresAt };
}

/**
 * Return a valid access token, refreshing when expired. `persist` is called
 * with new encrypted values so the caller can update its connection row.
 */
export async function getAccessToken(stored: StoredTokens, aad: string, persist: (next: StoredTokens) => Promise<void>, fetchImpl: FetchLike = fetch): Promise<string> {
  if (stored.encryptedAccessToken && stored.accessTokenExpiresAt && stored.accessTokenExpiresAt.getTime() > Date.now() + 30_000) {
    return decryptSecret(stored.encryptedAccessToken, aad);
  }
  const refreshToken = decryptSecret(stored.encryptedRefreshToken, aad);
  const t = await refreshAccessToken(refreshToken, fetchImpl);
  const next = encryptTokens({ refreshToken, accessToken: t.accessToken, expiresAt: t.expiresAt }, aad);
  await persist(next);
  return t.accessToken;
}

/** Standard handling for Google REST error responses. */
export async function googleApiError(res: Response, service: string): Promise<AppError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string; details?: Array<{ reason?: string }> } };
  const msg = body.error?.message ?? `HTTP ${res.status}`;
  const reason = body.error?.details?.[0]?.reason;
  if (res.status === 401) return new AppError("PROVIDER_AUTH_FAILED", `${service}: authorization expired; reconnect the account.`, { provider: service, reason }, { reportable: false });
  if (res.status === 403) return new AppError("PROVIDER_AUTH_FAILED", `${service}: ${msg}`, { provider: service, reason, status: 403 }, { reportable: false });
  if (res.status === 429) return new AppError("RATE_LIMITED", `${service}: quota exceeded`, { provider: service, reason }, { reportable: false });
  if (res.status >= 500) return new AppError("UPSTREAM_UNAVAILABLE", `${service}: ${msg}`, { provider: service }, { reportable: false });
  return new AppError("PROVIDER_ERROR", `${service}: ${msg}`, { provider: service, status: res.status, reason });
}

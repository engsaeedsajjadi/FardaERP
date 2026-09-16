/**
 * SSRF policy (spec §11): hostname policy + DNS resolution + address pinning.
 *
 * Design: the crawler never lets Node resolve a hostname on its own. We resolve
 * here, reject any private/reserved answer, and hand the *validated IP* to the
 * HTTP layer (see safe-fetch.ts) so a DNS-rebinding attacker cannot swap the
 * answer between validation and connect. Every redirect hop repeats the full
 * validation.
 */
import dns from "node:dns";
import net from "node:net";
import { AppError } from "@seopilot/shared";
import { canonicalIpv4Literal, isPrivateAddress } from "./ip";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.azure.com",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".home.arpa", ".onion", ".svc", ".cluster.local", ".in-addr.arpa", ".ip6.arpa"];

export interface SsrfPolicy {
  /** Allow http:// (not just https://). Default true; crawler must see http sites. */
  allowHttp?: boolean;
  /** Additional hostnames the operator explicitly permits (self-hosted intranet audits). */
  allowHosts?: string[];
  /** Allowed ports. Default [80, 443, 8080, 8443]. */
  allowPorts?: number[];
  /** Only for tests with a controlled local server. NEVER set in production code paths. */
  allowPrivateForTesting?: boolean;
}

export interface ValidatedTarget {
  url: URL;
  hostname: string;
  /** Validated IP addresses (all answers passed the policy). */
  addresses: string[];
  /** Address to pin for the connection. */
  address: string;
  family: 4 | 6;
  port: number;
}

export class SsrfBlockedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("SSRF_BLOCKED", message, details, { reportable: false });
    this.name = "SsrfBlockedError";
  }
}

export function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const zone = host.indexOf("%");
  if (zone !== -1) host = host.slice(0, zone);
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

function defaultPorts(policy: SsrfPolicy): number[] {
  return policy.allowPorts ?? [80, 443, 8080, 8443];
}

/**
 * Synchronous policy check on a URL string. Rejects bad schemes, credentials in
 * the URL, blocked hostnames, and private IP literals (including obfuscated
 * decimal/octal/hex forms). Does not resolve DNS — see `resolveAndValidate`.
 */
export function assertUrlPolicy(input: string | URL, policy: SsrfPolicy = {}): URL {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    throw new SsrfBlockedError("Invalid URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (policy.allowHttp ?? true))) {
    throw new SsrfBlockedError(`Protocol not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) throw new SsrfBlockedError("Credentials in URL are not allowed");

  const host = normalizeHostname(url.hostname);
  if (!host) throw new SsrfBlockedError("Empty hostname");

  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!defaultPorts(policy).includes(port)) throw new SsrfBlockedError(`Port not allowed: ${port}`, { port });

  if (policy.allowHosts?.includes(host)) return url;
  if (policy.allowPrivateForTesting) return url;

  if (BLOCKED_HOSTS.has(host)) throw new SsrfBlockedError(`Blocked hostname: ${host}`, { host });
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new SsrfBlockedError(`Blocked hostname suffix: ${host}`, { host });

  const v4 = canonicalIpv4Literal(host);
  if (v4) {
    if (isPrivateAddress(v4)) throw new SsrfBlockedError(`Private address: ${host}`, { host });
    return url;
  }
  if (net.isIPv6(host)) {
    if (isPrivateAddress(host)) throw new SsrfBlockedError(`Private address: ${host}`, { host });
    return url;
  }
  if (!host.includes(".")) throw new SsrfBlockedError(`Unqualified hostname: ${host}`, { host });
  return url;
}

/**
 * Resolve the hostname and validate *every* answer. Returns the pinned address
 * the connection must use. Fails closed on resolver errors.
 */
export async function resolveAndValidate(input: string | URL, policy: SsrfPolicy = {}): Promise<ValidatedTarget> {
  const url = assertUrlPolicy(input, policy);
  const hostname = normalizeHostname(url.hostname);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;

  const literal4 = canonicalIpv4Literal(hostname);
  if (literal4) return { url, hostname, addresses: [literal4], address: literal4, family: 4, port };
  if (net.isIPv6(hostname)) return { url, hostname, addresses: [hostname], address: hostname, family: 6, port };

  let answers: dns.LookupAddress[];
  try {
    answers = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new SsrfBlockedError(`DNS resolution failed for ${hostname}`, { host: hostname, cause: err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.message) : String(err) });
  }
  if (answers.length === 0) throw new SsrfBlockedError(`DNS returned no addresses for ${hostname}`, { host: hostname });

  const allowPrivate = policy.allowPrivateForTesting === true || policy.allowHosts?.includes(hostname) === true;
  for (const a of answers) {
    if (!allowPrivate && isPrivateAddress(a.address)) {
      throw new SsrfBlockedError(`${hostname} resolves to a private address`, { host: hostname, address: a.address });
    }
  }
  // Prefer IPv4 when available: fewer egress surprises in container networks.
  const chosen = answers.find((a) => a.family === 4) ?? (answers[0] as dns.LookupAddress);
  return { url, hostname, addresses: answers.map((a) => a.address), address: chosen.address, family: chosen.family as 4 | 6, port };
}

export function isCrawlableUrl(input: string, policy: SsrfPolicy = {}): boolean {
  try {
    assertUrlPolicy(input, policy);
    return true;
  } catch {
    return false;
  }
}

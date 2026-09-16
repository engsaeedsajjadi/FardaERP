/**
 * SSRF-safe HTTP client used by the crawler and every outbound fetch to a
 * user-controlled URL (sitemaps, robots.txt, webhooks, PageSpeed targets).
 *
 * Structure adapted from OpenGSC `src/lib/security/safeFetch.ts` (MIT, © 2026 OpenGSC):
 * the connection is dialled to the *validated IP* while TLS SNI and the Host
 * header keep the hostname, so DNS rebinding between check and connect is
 * impossible. Response bodies are capped, redirects are followed manually and
 * re-validated on every hop, and decompression is bounded.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import zlib from "node:zlib";
import { resolveAndValidate, SsrfBlockedError, type SsrfPolicy } from "./ssrf";

export type SafeFetchErrorCode =
  | "ssrf_blocked"
  | "timeout"
  | "response_too_large"
  | "too_many_redirects"
  | "network_error"
  | "tls_error";

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  redirect?: "follow" | "manual";
  policy?: SsrfPolicy;
  signal?: AbortSignal;
}

export interface SafeFetchResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: Headers;
  /** Final URL after redirects. */
  url: string;
  redirected: boolean;
  /** Redirect chain (URLs visited before the final one). */
  redirectChain: Array<{ url: string; status: number }>;
  body: Buffer;
  byteLength: number;
  /** Time from request start to headers received (ms). */
  ttfbMs: number;
  totalMs: number;
  /** Resolved address actually connected to. */
  remoteAddress: string;
  contentEncoding: string | null;
  text(): string;
  json<T = unknown>(): T;
}

const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

function decompress(buf: Buffer, encoding: string | null, maxBytes: number): Buffer {
  if (!encoding || buf.length === 0) return buf;
  const enc = encoding.toLowerCase();
  const opts = { maxOutputLength: maxBytes };
  try {
    if (enc === "gzip" || enc === "x-gzip") return zlib.gunzipSync(buf, opts);
    if (enc === "deflate") return zlib.inflateSync(buf, opts);
    if (enc === "br") return zlib.brotliDecompressSync(buf, { maxOutputLength: maxBytes });
    if (enc === "zstd" && typeof (zlib as unknown as { zstdDecompressSync?: unknown }).zstdDecompressSync === "function") {
      return (zlib as unknown as { zstdDecompressSync: (b: Buffer, o: unknown) => Buffer }).zstdDecompressSync(buf, { maxOutputLength: maxBytes });
    }
  } catch (err) {
    if (err instanceof RangeError || (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw new SafeFetchError("response_too_large", `Decompressed body exceeds ${maxBytes} bytes`);
    }
    throw new SafeFetchError("network_error", "Failed to decompress response", { cause: err });
  }
  return buf;
}

async function singleRequest(
  urlStr: string,
  opts: Required<Pick<SafeFetchOptions, "method" | "timeoutMs" | "maxBytes">> & SafeFetchOptions,
): Promise<{ res: http.IncomingMessage; body: Buffer; remoteAddress: string; ttfbMs: number }> {
  const target = await resolveAndValidate(urlStr, opts.policy);
  const { url, hostname, address, family, port } = target;
  const isTls = url.protocol === "https:";
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-encoding": "gzip, deflate, br",
      ...opts.headers,
    };
    headers["host"] = url.port ? `${hostname}:${url.port}` : hostname;

    const agentOpts: https.RequestOptions = {
      method: opts.method,
      host: address, // pinned IP
      port,
      path: url.pathname + url.search,
      headers,
      family,
      servername: net.isIP(hostname) ? undefined : hostname, // SNI
      timeout: opts.timeoutMs,
      // Re-check the socket peer: a proxy env var or custom lookup cannot redirect us.
      lookup: ((_h: string, _o: unknown, cb: (e: Error | null, addr: string, fam: number) => void) => cb(null, address, family)) as never,
      agent: false,
    };
    if (isTls) {
      (agentOpts as tls.ConnectionOptions).checkServerIdentity = (host, cert) => tls.checkServerIdentity(hostname, cert) ?? (host ? undefined : undefined);
    }

    const lib = isTls ? https : http;
    const req = lib.request(agentOpts, (res) => {
      const ttfbMs = Date.now() - started;
      const chunks: Buffer[] = [];
      let received = 0;
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > opts.maxBytes) {
        res.destroy();
        reject(new SafeFetchError("response_too_large", `Content-Length ${declared} exceeds limit ${opts.maxBytes}`));
        return;
      }
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > opts.maxBytes) {
          res.destroy();
          reject(new SafeFetchError("response_too_large", `Body exceeds limit ${opts.maxBytes}`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ res, body: Buffer.concat(chunks), remoteAddress: req.socket?.remoteAddress ?? address, ttfbMs }));
      res.on("error", (err) => reject(new SafeFetchError("network_error", err.message, { cause: err })));
    });

    req.on("timeout", () => {
      req.destroy(new SafeFetchError("timeout", `Request timed out after ${opts.timeoutMs} ms`));
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err instanceof SafeFetchError) return reject(err);
      const code = err.code ?? "";
      if (code.startsWith("ERR_TLS") || code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "ERR_SSL_WRONG_VERSION_NUMBER" || code === "SELF_SIGNED_CERT_IN_CHAIN") {
        return reject(new SafeFetchError("tls_error", `${code}: ${err.message}`, { cause: err }));
      }
      reject(new SafeFetchError("network_error", `${code || err.name}: ${err.message}`, { cause: err }));
    });
    req.on("socket", (socket) => {
      socket.once("connect", () => {
        // Defence in depth: verify the peer we connected to is the address we validated.
        const remote = socket.remoteAddress;
        if (remote && remote !== address && remote !== `::ffff:${address}`) {
          req.destroy(new SafeFetchError("ssrf_blocked", `Connected to unexpected address ${remote}`));
        }
      });
    });
    if (opts.signal) {
      if (opts.signal.aborted) req.destroy(new SafeFetchError("timeout", "Aborted"));
      else opts.signal.addEventListener("abort", () => req.destroy(new SafeFetchError("timeout", "Aborted")), { once: true });
    }
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const opts = {
    ...options,
    method: options.method ?? "GET",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  };
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const startedAll = Date.now();
  const chain: Array<{ url: string; status: number }> = [];
  let current = typeof input === "string" ? input : input.toString();

  for (let hop = 0; ; hop++) {
    let result: Awaited<ReturnType<typeof singleRequest>>;
    try {
      result = await singleRequest(current, opts);
    } catch (err) {
      if (err instanceof SsrfBlockedError) throw new SafeFetchError("ssrf_blocked", err.message, { cause: err });
      throw err;
    }
    const { res, body, remoteAddress, ttfbMs } = result;
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    const isRedirect = status >= 300 && status < 400 && typeof location === "string";

    if (isRedirect && (options.redirect ?? "follow") === "follow") {
      chain.push({ url: current, status });
      if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects", `Exceeded ${maxRedirects} redirects`);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new SafeFetchError("network_error", `Invalid redirect Location: ${location}`);
      }
      next.hash = "";
      current = next.toString();
      // 303 (and 301/302 on POST) become GET per fetch spec.
      if (status === 303 || ((status === 301 || status === 302) && opts.method === "POST")) {
        opts.method = "GET";
        delete opts.body;
      }
      continue;
    }

    const encoding = (res.headers["content-encoding"] as string | undefined) ?? null;
    const decoded = decompress(body, encoding, opts.maxBytes);
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else headers.set(k, v);
    }
    const text = () => decoded.toString("utf8");
    return {
      status,
      statusText: res.statusMessage ?? "",
      ok: status >= 200 && status < 300,
      headers,
      url: current,
      redirected: chain.length > 0,
      redirectChain: chain,
      body: decoded,
      byteLength: decoded.length,
      ttfbMs,
      totalMs: Date.now() - startedAll,
      remoteAddress,
      contentEncoding: encoding,
      text,
      json: <T>() => JSON.parse(text()) as T,
    };
  }
}

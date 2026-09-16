import { describe, it, expect } from "vitest";
import http from "node:http";
import { assertUrlPolicy, resolveAndValidate, isCrawlableUrl, SsrfBlockedError } from "./ssrf";
import { isPrivateAddress, canonicalIpv4Literal, expandIpv6, embeddedIpv4 } from "./ip";
import { safeFetch, SafeFetchError } from "./safe-fetch";

describe("ip classification", () => {
  it.each([
    ["127.0.0.1", true], ["127.255.255.254", true], ["10.0.0.1", true], ["10.255.255.255", true],
    ["172.16.0.1", true], ["172.31.255.255", true], ["172.32.0.1", false], ["192.168.1.1", true],
    ["169.254.169.254", true], ["100.64.0.1", true], ["0.0.0.0", true], ["224.0.0.1", true], ["255.255.255.255", true],
    ["8.8.8.8", false], ["1.1.1.1", false], ["93.184.216.34", false],
    ["::1", true], ["::", true], ["fc00::1", true], ["fd12:3456::1", true], ["fe80::1", true], ["ff02::1", true],
    ["::ffff:127.0.0.1", true], ["::ffff:7f00:1", true], ["::ffff:8.8.8.8", false], ["64:ff9b::7f00:1", true], ["2002:7f00:1::", true],
    ["2001:0:0:0:0:0:8000:fffe", true], // Teredo embedding 127.255.0.1 (xor)
    ["2001:4860:4860::8888", false], ["2606:4700::1111", false],
  ])("%s private=%s", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });

  it("normalises obfuscated IPv4 literals", () => {
    expect(canonicalIpv4Literal("2130706433")).toBe("127.0.0.1");
    expect(canonicalIpv4Literal("0x7f000001")).toBe("127.0.0.1");
    expect(canonicalIpv4Literal("0177.0.0.1")).toBe("127.0.0.1");
    expect(canonicalIpv4Literal("127.1")).toBe("127.0.0.1");
    expect(canonicalIpv4Literal("0x7f.1")).toBe("127.0.0.1");
    expect(canonicalIpv4Literal("example.com")).toBeNull();
  });

  it("expands ipv6 and extracts embedded v4", () => {
    const g = expandIpv6("::ffff:10.0.0.5");
    expect(g).not.toBeNull();
    expect(embeddedIpv4(g as number[])).toBe("10.0.0.5");
  });
});

describe("url policy", () => {
  it.each([
    "http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://127.1/",
    "http://10.0.0.1:80/", "http://foo.internal/", "http://foo.local/", "http://intranet/", "ftp://example.com/", "file:///etc/passwd",
    "gopher://example.com/", "http://user:pass@example.com/", "http://example.com:22/", "http://example.com:6379/", "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
  ])("blocks %s", (url) => {
    expect(() => assertUrlPolicy(url)).toThrow(SsrfBlockedError);
    expect(isCrawlableUrl(url)).toBe(false);
  });

  it.each(["https://example.com/", "http://example.com/path?q=1", "https://sub.example.co.uk:8443/x", "https://8.8.8.8/"])("allows %s", (url) => {
    expect(() => assertUrlPolicy(url)).not.toThrow();
  });

  it("allows explicitly allow-listed hosts (self-hosted intranet audit)", () => {
    expect(() => assertUrlPolicy("http://intranet.corp/", { allowHosts: ["intranet.corp"] })).not.toThrow();
  });

  it("rejects hostnames resolving to private addresses", async () => {
    // localhost via DNS-style name that resolves to loopback on every system.
    await expect(resolveAndValidate("http://localhost.localdomain/", { allowHosts: [] })).rejects.toThrow(SsrfBlockedError);
  });
});

describe("safeFetch against a local server", () => {
  function startServer(handler: http.RequestListener): Promise<{ url: string; close: () => void; port: number }> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as { port: number }).port;
        resolve({ url: `http://127.0.0.1:${port}`, port, close: () => server.close() });
      });
    });
  }
  // Allow only the loopback test server itself, so redirects to other private targets are still blocked.
  const policy = { allowHosts: ["127.0.0.1"], allowPorts: Array.from({ length: 65535 }, (_, i) => i + 1) };

  it("refuses private targets unless the test policy is set", async () => {
    const s = await startServer((_, res) => res.end("ok"));
    try {
      await expect(safeFetch(s.url, { policy: { allowPorts: [s.port] } })).rejects.toMatchObject({ code: "ssrf_blocked" });
    } finally {
      s.close();
    }
  });

  it("fetches, follows redirects with a recorded chain, and revalidates each hop", async () => {
    const s = await startServer((req, res) => {
      if (req.url === "/a") {
        res.writeHead(301, { location: "/b" });
        res.end();
      } else if (req.url === "/b") {
        res.writeHead(302, { location: "/c" });
        res.end();
      } else if (req.url === "/c") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><title>ok</title></html>");
      } else if (req.url === "/to-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
      }
    });
    try {
      const r = await safeFetch(`${s.url}/a`, { policy });
      expect(r.status).toBe(200);
      expect(r.redirectChain.map((h) => h.status)).toEqual([301, 302]);
      expect(r.url).toBe(`${s.url}/c`);
      expect(r.text()).toContain("<title>ok</title>");
      await expect(safeFetch(`${s.url}/to-metadata`, { policy })).rejects.toMatchObject({ code: "ssrf_blocked" });
    } finally {
      s.close();
    }
  });

  it("caps response size", async () => {
    const s = await startServer((_, res) => {
      res.writeHead(200);
      res.end(Buffer.alloc(200_000, "a"));
    });
    try {
      await expect(safeFetch(s.url, { policy, maxBytes: 50_000 })).rejects.toBeInstanceOf(SafeFetchError);
    } finally {
      s.close();
    }
  });

  it("times out", async () => {
    const s = await startServer(() => {
      /* never respond */
    });
    try {
      await expect(safeFetch(s.url, { policy, timeoutMs: 300 })).rejects.toMatchObject({ code: "timeout" });
    } finally {
      s.close();
    }
  });

  it("stops after max redirects", async () => {
    const s = await startServer((req, res) => {
      const n = Number(req.url?.slice(1) || 0);
      res.writeHead(302, { location: `/${n + 1}` });
      res.end();
    });
    try {
      await expect(safeFetch(`${s.url}/0`, { policy, maxRedirects: 3 })).rejects.toMatchObject({ code: "too_many_redirects" });
    } finally {
      s.close();
    }
  });
});

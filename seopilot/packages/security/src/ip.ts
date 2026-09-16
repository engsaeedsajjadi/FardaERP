/**
 * IP classification for SSRF defence (spec §11).
 *
 * Adapted from the CIDR tables in RosterSeo `packages/crawler/src/ssrf-guard.ts`
 * (MIT, © 2026 RosterSEO contributors) and OpenSEO `src/server/lib/audit/url-policy.ts`
 * (MIT, © 2026 Ben Senescu); rewritten for full IPv6 CIDR support.
 */
import net from "node:net";

const PRIVATE_IPV4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local incl. 169.254.169.254 metadata
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay (deprecated)
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

const PRIVATE_IPV6: Array<[string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::ffff:0:0", 96], // IPv4-mapped (checked separately via the v4 table)
  ["64:ff9b::", 96], // NAT64 well-known prefix (maps to v4; checked separately)
  ["100::", 64], // discard-only
  ["2001::", 32], // Teredo (tunnels arbitrary v4)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds v4)
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** Expand an IPv6 textual address into 8 16-bit groups. Returns null when malformed. */
export function expandIpv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  // Embedded IPv4 tail, e.g. ::ffff:1.2.3.4
  const v4Tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const v4 = v4Tail[1] as string;
    if (net.isIPv4(v4) === false) return null;
    const [a, b, c, d] = v4.split(".").map(Number) as [number, number, number, number];
    addr = addr.slice(0, -v4.length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function inCidr6(groups: number[], base: string, bits: number): boolean {
  const b = expandIpv6(base);
  if (!b) return false;
  let remaining = bits;
  for (let i = 0; i < 8; i++) {
    if (remaining <= 0) return true;
    const take = Math.min(16, remaining);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if (((groups[i] as number) & mask) !== ((b[i] as number) & mask)) return false;
    remaining -= take;
  }
  return true;
}

/** Extract an embedded IPv4 address from mapped / NAT64 / 6to4 / Teredo forms. */
export function embeddedIpv4(groups: number[]): string | null {
  const g = groups as [number, number, number, number, number, number, number, number];
  const fromGroups = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  // ::ffff:a.b.c.d
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return fromGroups(g[6], g[7]);
  // 64:ff9b::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return fromGroups(g[6], g[7]);
  // 2002:abcd:ef01:: (6to4)
  if (g[0] === 0x2002) return fromGroups(g[1], g[2]);
  // 2001:0000:...:xxxx:yyyy Teredo — client v4 is the last 32 bits XOR 0xffff
  if (g[0] === 0x2001 && g[1] === 0) return fromGroups(g[6] ^ 0xffff, g[7] ^ 0xffff);
  return null;
}

export function isPrivateIpv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;
  return PRIVATE_IPV4.some(([base, bits]) => inCidr4(ip, base, bits));
}

export function isPrivateIpv6(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (!groups) return true; // malformed -> treat as unsafe
  const embedded = embeddedIpv4(groups);
  if (embedded && isPrivateIpv4(embedded)) return true;
  return PRIVATE_IPV6.some(([base, bits]) => inCidr6(groups, base, bits));
}

/** True when the address is loopback, private, link-local, reserved, multicast or maps to one. */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateIpv4(ip);
  if (v === 6) return isPrivateIpv6(ip);
  return true; // not an IP -> caller must resolve first
}

/** Normalise obfuscated IPv4 literals (decimal, octal, hex, short forms) to dotted quad, or null. */
export function canonicalIpv4Literal(host: string): string | null {
  const h = host.trim().toLowerCase();
  if (net.isIPv4(h)) {
    // Node accepts only canonical dotted quads here; still normalise leading zeros semantics.
    return h;
  }
  // Pure decimal e.g. 2130706433
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (!Number.isSafeInteger(n) || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  // Hex e.g. 0x7f000001
  if (/^0x[0-9a-f]+$/.test(h)) {
    const n = parseInt(h, 16);
    if (n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  // Dotted forms with octal/hex parts or fewer than 4 parts e.g. 0177.0.0.1, 127.1
  const parts = h.split(".");
  if (parts.length >= 1 && parts.length <= 4 && parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*|0)$/.test(p))) {
    const nums = parts.map((p) => (p.startsWith("0x") ? parseInt(p, 16) : p.length > 1 && p.startsWith("0") ? parseInt(p, 8) : Number(p)));
    if (nums.some((n) => Number.isNaN(n))) return null;
    const last = nums.pop() as number;
    const maxLast = 2 ** (8 * (4 - nums.length));
    if (last >= maxLast || nums.some((n) => n > 255)) return null;
    const bytes = [...nums];
    for (let i = 4 - nums.length - 1; i >= 0; i--) bytes.push((last >>> (8 * i)) & 255);
    return bytes.join(".");
  }
  return null;
}

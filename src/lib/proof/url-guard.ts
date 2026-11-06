import { isIP } from "node:net";

/**
 * SSRF protection for creator-submitted URLs.
 *
 * Two layers:
 *   1. `validatePublicUrl` — syntactic checks (scheme, credentials, port, literal IPs, hostnames).
 *   2. `isPublicIp` — applied to EVERY address the hostname resolves to, inside the socket's
 *      DNS lookup (see safe-fetch.ts). Checking at connect time defeats DNS rebinding.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /^metadata\.google\.internal$/i, /\.home\.arpa$/i];

export function validatePublicUrl(input: string, opts: { allowHttp?: boolean } = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) return { ok: false, reason: "Only https:// URLs are accepted." };
  if (url.username || url.password) return { ok: false, reason: "URLs with credentials are not accepted." };
  if (url.port && !["80", "443"].includes(url.port)) return { ok: false, reason: "Non-standard ports are not accepted." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host.length > 253) return { ok: false, reason: "Invalid hostname." };
  if (BLOCKED_HOSTNAMES.some((r) => r.test(host))) return { ok: false, reason: "Internal hostnames are not accepted." };
  if (isIP(host)) {
    if (!isPublicIp(host)) return { ok: false, reason: "Private or reserved IP addresses are not accepted." };
  } else if (!host.includes(".")) {
    return { ok: false, reason: "Hostname must be fully qualified." };
  }
  // Decimal/octal/hex IPv4 shorthands (e.g. http://2130706433) are normalised by WHATWG URL,
  // so they are caught by isIP above.
  return { ok: true, url };
}

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function inV4Block(ip: string) {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // Embedded IPv4 tail
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    s = s.replace(v4[1], `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = s.includes("::") ? 8 - h.length - t.length : 0;
  const parts = [...h, ...Array(fill).fill("0"), ...t];
  if (parts.length !== 8) return null;
  return parts.map((p) => parseInt(p || "0", 16));
}

export function isPublicIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return !inV4Block(ip);
  if (fam === 6) {
    const p = expandV6(ip);
    if (!p) return false;
    if (p.every((x) => x === 0)) return false; // ::
    if (p.slice(0, 7).every((x) => x === 0) && p[7] === 1) return false; // ::1
    // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible — judge by the embedded v4 address
    if (p.slice(0, 5).every((x) => x === 0) && (p[5] === 0xffff || p[5] === 0)) {
      const v4 = `${p[6] >> 8}.${p[6] & 255}.${p[7] >> 8}.${p[7] & 255}`;
      return !inV4Block(v4);
    }
    if (p[0] === 0x64 && p[1] === 0xff9b) return false; // NAT64 64:ff9b::/96
    if ((p[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((p[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
    if ((p[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
    if ((p[0] & 0xff00) === 0xff00) return false; // multicast
    if (p[0] === 0x2001 && p[1] === 0x0db8) return false; // documentation
    if (p[0] === 0x2002) return false; // 6to4 can embed private v4
    if ((p[0] & 0xe000) !== 0x2000) return false; // Only global-unicast allocations.
    if (p[0] === 0x2001 && p[1] < 0x0200) return false; // Teredo and special-purpose assignments.
    return true;
  }
  return false;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

/** GitHub URLs are allowlisted to github.com/{owner}/{repo}. */
export function parseGithubRepo(input: string): { owner: string; repo: string } | null {
  const v = validatePublicUrl(input);
  if (!v.ok || !GITHUB_HOSTS.has(v.url.hostname.toLowerCase())) return null;
  const [owner, repo] = v.url.pathname.split("/").filter(Boolean);
  if (!owner || !repo) return null;
  const clean = repo.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(clean)) return null;
  return { owner, repo: clean };
}

import { createHash } from "node:crypto";
import { keccak256 } from "viem";
import { safeFetch, SafeFetchError, type SafeFetchResult } from "../proof/safe-fetch";
import { displayText, jsonSafe } from "../util/sanitize";
import { redactSecrets } from "../chain/rpc-errors";

/**
 * Launch-metadata ingestion. Every network request goes through `safeFetch` (public IPs only,
 * checked at connect time; redirects re-validated; time and size capped; no compression).
 *
 * Integrity is checked cryptographically wherever possible, so a gateway does not have to be
 * trusted:
 *   - raw-codec sha2-256 CIDs (`bafkrei…`, what vibe/vibe uses): sha256(bytes) must equal the CID digest;
 *   - launch events with a metadata digest (vibe/vibe v5): keccak256(bytes) must equal it.
 *
 * The CONTENT remains a creator claim. A matching hash proves only that these are the bytes the
 * creator committed to, not that a website, description or social account is genuine.
 */

export const METADATA_MAX_BYTES = 64 * 1024;

export type NormalizedUri =
  | { kind: "ipfs"; cid: string; path: string; original: string }
  | { kind: "https"; url: string; original: string }
  | { kind: "unsupported"; reason: string; original: string };

const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_B32 = /^b[a-z2-7]{20,200}$/;
const SAFE_PATH = /^(\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*\/?$/;

function cidOk(cid: string) {
  return CID_V0.test(cid) || CID_V1_B32.test(cid);
}

function cleanPath(p: string): string | null {
  if (!p || p === "/") return "";
  const path = p.startsWith("/") ? p : `/${p}`;
  if (!SAFE_PATH.test(path) || path.split("/").some((s) => s === ".." || s === ".")) return null;
  return path.length > 512 ? null : path;
}

/** ipfs://CID[/path], ipfs://ipfs/CID, https://gw/ipfs/CID[/path], https://CID.ipfs.gw[/path] → ipfs; https → https. */
export function normalizeMetadataUri(input: string): NormalizedUri {
  const original = input;
  const s = input.trim();
  if (!s) return { kind: "unsupported", reason: "empty", original };
  if (s.length > 2048) return { kind: "unsupported", reason: "URI longer than 2048 characters", original };
  const ipfs = s.match(/^ipfs:\/\/(?:ipfs\/)?([^/?#]+)([^?#]*)$/i);
  if (ipfs) {
    const path = cleanPath(ipfs[2]);
    if (!cidOk(ipfs[1])) return { kind: "unsupported", reason: "not a valid IPFS CID", original };
    if (path === null) return { kind: "unsupported", reason: "unsafe IPFS path", original };
    return { kind: "ipfs", cid: ipfs[1], path, original };
  }
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return { kind: "unsupported", reason: "not a URL", original };
  }
  if (url.protocol !== "https:") return { kind: "unsupported", reason: `${url.protocol.replace(":", "")} URIs are not fetched (https and ipfs only)`, original };
  const gwPath = url.pathname.match(/^\/ipfs\/([^/]+)(.*)$/);
  if (gwPath && cidOk(gwPath[1])) {
    const path = cleanPath(gwPath[2]);
    if (path !== null) return { kind: "ipfs", cid: gwPath[1], path, original };
  }
  const sub = url.hostname.match(/^([a-z2-7]+)\.ipfs\./);
  if (sub && CID_V1_B32.test(sub[1])) {
    const path = cleanPath(url.pathname);
    if (path !== null) return { kind: "ipfs", cid: sub[1], path, original };
  }
  return { kind: "https", url: url.toString(), original };
}

/**
 * Gateway URL templates, tried in order. `{cid}` and `{path}` are substituted. Subdomain
 * templates need a CIDv1 (base32) and are skipped for CIDv0. Observed 2026-10-03:
 * ipfs.io / dweb.link answered 429 ("switching to a service worker gateway"); filebase and
 * 4everland served content.
 */
export function gatewayTemplates(): string[] {
  const env = process.env.IPFS_GATEWAYS?.split(",").map((s) => s.trim()).filter(Boolean);
  return env?.length ? env : ["https://ipfs.filebase.io/ipfs/{cid}{path}", "https://{cid}.ipfs.4everland.io{path}", "https://ipfs.io/ipfs/{cid}{path}"];
}

export function gatewayUrls(cid: string, path: string, templates = gatewayTemplates()): string[] {
  return templates
    .filter((t) => !(t.includes("{cid}.") && !CID_V1_B32.test(cid)))
    .map((t) => t.replace("{cid}", cid).replace("{path}", path));
}

// ── CID decoding (CIDv1, multibase base32 lower) ───────────────────────────
function base32Decode(s: string): Uint8Array {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error("bad base32");
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

function varint(bytes: Uint8Array, at: number): [number, number] {
  let x = 0;
  let shift = 0;
  for (let i = at; i < bytes.length && i < at + 9; i++) {
    x += (bytes[i] & 0x7f) * 2 ** shift;
    if (!(bytes[i] & 0x80)) return [x, i + 1];
    shift += 7;
  }
  throw new Error("bad varint");
}

/** sha2-256 digest (hex) of a CIDv1 raw-codec CID, or null if the CID is not of that checkable kind. */
export function rawSha256Digest(cid: string): string | null {
  if (!CID_V1_B32.test(cid)) return null;
  try {
    const b = base32Decode(cid.slice(1));
    let [version, i] = varint(b, 0);
    if (version !== 1) return null;
    let codec: number;
    [codec, i] = varint(b, i);
    let hashCode: number;
    [hashCode, i] = varint(b, i);
    let len: number;
    [len, i] = varint(b, i);
    if (codec !== 0x55 || hashCode !== 0x12 || len !== 32 || b.length !== i + 32) return null;
    return Buffer.from(b.subarray(i, i + 32)).toString("hex");
  } catch {
    return null;
  }
}

// ── Fetch ──────────────────────────────────────────────────────────────────
export type MetadataStatus = "ok" | "not_json" | "invalid" | "too_large" | "unavailable" | "not_found" | "blocked" | "unsupported_uri" | "integrity_mismatch";

export type MetadataClaims = {
  name: string | null;
  symbol: string | null;
  description: string | null;
  image: string | null;
  chainId: number | null;
  creator: string | null;
  website: string | null;
  x: string | null;
  telegram: string | null;
  discord: string | null;
  projectTypes: string[];
};

export type MetadataResult = {
  status: MetadataStatus;
  /** Whether a later retry could succeed (network/gateway problems). */
  retryable: boolean;
  normalizedUrl: string | null;
  gateway: string | null;
  httpStatus: number | null;
  contentType: string | null;
  bytes: number | null;
  keccak256: `0x${string}` | null;
  sha256: `0x${string}` | null;
  cidVerified: boolean | null;
  digestMatch: boolean | null;
  data: Record<string, unknown> | null;
  claims: MetadataClaims | null;
  error: string | null;
  attempts: { url: string; outcome: string }[];
};

type Fetcher = (url: string, opts: Parameters<typeof safeFetch>[1]) => Promise<SafeFetchResult>;

const str = (v: unknown, max = 300) => (typeof v === "string" ? displayText(v, max) : null);
const httpsUrl = (v: unknown) => {
  const s = str(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};

/** Extract the known vibe/vibe metadata fields (schemaVersion 1) as display-safe creator claims. */
export function extractClaims(data: Record<string, unknown>): MetadataClaims {
  const socials = (data.socials && typeof data.socials === "object" ? data.socials : {}) as Record<string, unknown>;
  const image = data.image && typeof data.image === "object" ? (data.image as Record<string, unknown>).uri : data.image;
  return {
    name: str(data.name, 200),
    symbol: str(data.symbol, 64),
    description: str(data.description, 1000),
    image: str(image, 500),
    chainId: typeof data.chainId === "number" && Number.isInteger(data.chainId) ? data.chainId : null,
    creator: typeof data.creator === "string" && /^0x[0-9a-fA-F]{40}$/.test(data.creator) ? data.creator.toLowerCase() : null,
    website: httpsUrl(socials.website ?? data.website ?? data.external_url),
    x: httpsUrl(socials.x ?? socials.twitter),
    telegram: httpsUrl(socials.telegram),
    discord: httpsUrl(socials.discord),
    projectTypes: Array.isArray(data.projectTypes) ? data.projectTypes.filter((x): x is string => typeof x === "string").slice(0, 10).map((x) => displayText(x, 64)!) : [],
  };
}

function empty(status: MetadataStatus, error: string | null, retryable = false): MetadataResult {
  return { status, retryable, normalizedUrl: null, gateway: null, httpStatus: null, contentType: null, bytes: null, keccak256: null, sha256: null, cidVerified: null, digestMatch: null, data: null, claims: null, error, attempts: [] };
}

const JSONISH = /^(application\/(json|ld\+json|octet-stream)|text\/plain)\b/i;

export async function fetchMetadata(uri: string, opts: { onchainDigest?: `0x${string}` | null; fetcher?: Fetcher; timeoutMs?: number; maxBytes?: number; templates?: string[] } = {}): Promise<MetadataResult> {
  const n = normalizeMetadataUri(uri);
  if (n.kind === "unsupported") return empty("unsupported_uri", n.reason);
  const fetcher: Fetcher = opts.fetcher ?? safeFetch;
  const maxBytes = opts.maxBytes ?? METADATA_MAX_BYTES;
  const urls = n.kind === "ipfs" ? gatewayUrls(n.cid, n.path, opts.templates) : [n.url];
  const expectedSha = n.kind === "ipfs" && !n.path ? rawSha256Digest(n.cid) : null;
  const attempts: MetadataResult["attempts"] = [];
  let last: MetadataResult = empty("unavailable", "no gateway attempted", true);
  let sawMismatch = false;

  for (const url of urls) {
    const gateway = new URL(url).host;
    let res: SafeFetchResult;
    try {
      res = await fetcher(url, { timeoutMs: opts.timeoutMs ?? 8_000, maxBytes, maxRedirects: 3, allowHttp: false, accept: "application/json, text/plain;q=0.5, */*;q=0.1" });
    } catch (e) {
      const kind = e instanceof SafeFetchError ? e.kind : "network";
      const msg = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200);
      attempts.push({ url, outcome: `${kind}: ${msg}` });
      if (kind === "blocked" && n.kind === "https") return { ...empty("blocked", msg), attempts };
      last = { ...empty(kind === "dns" && n.kind === "https" ? "not_found" : "unavailable", msg, kind !== "blocked"), gateway };
      continue;
    }
    const ctype = (Array.isArray(res.headers["content-type"]) ? res.headers["content-type"][0] : res.headers["content-type"]) ?? null;
    const enc = res.headers["content-encoding"];
    attempts.push({ url, outcome: `HTTP ${res.status}${res.truncated ? " (truncated)" : ""}` });
    const base = { normalizedUrl: url, gateway, httpStatus: res.status, contentType: ctype, error: null, claims: null, data: null };
    if (res.status === 404 || res.status === 410) {
      last = { ...empty(n.kind === "https" ? "not_found" : "unavailable", `HTTP ${res.status}`, n.kind === "ipfs"), ...base, error: `HTTP ${res.status}` };
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      last = { ...empty("unavailable", `HTTP ${res.status}`, true), ...base, error: `HTTP ${res.status}` };
      continue;
    }
    if (enc && !/^identity$/i.test(String(enc))) {
      last = { ...empty("unavailable", `Refused compressed response (${enc})`, true), ...base };
      continue;
    }
    if (res.truncated) return { ...empty("too_large", `Larger than ${maxBytes} bytes`), ...base, error: `Larger than ${maxBytes} bytes`, attempts };
    const bytes = res.bytes;
    const sha = createHash("sha256").update(bytes).digest("hex");
    const kec = keccak256(bytes);
    const cidVerified = expectedSha ? sha === expectedSha : null;
    if (cidVerified === false) {
      // The gateway served bytes that are not the CID's content; another gateway may be honest.
      sawMismatch = true;
      last = { ...empty("integrity_mismatch", "Content does not hash to the CID", true), ...base };
      continue;
    }
    const digestMatch = opts.onchainDigest ? kec.toLowerCase() === opts.onchainDigest.toLowerCase() : null;
    const common = { ...base, bytes: bytes.length, keccak256: kec, sha256: `0x${sha}` as `0x${string}`, cidVerified, digestMatch, attempts };
    if (ctype && !JSONISH.test(ctype) && bytes[0] !== 0x7b) return { ...empty("not_json", `Content-Type ${ctype}`), ...common, error: `Content-Type ${ctype} is not JSON` };
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      return { ...empty("invalid", "Not valid JSON"), ...common, error: "Not valid JSON" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...empty("invalid", "JSON is not an object"), ...common, error: "JSON is not an object" };
    const data = jsonSafe(parsed) as Record<string, unknown>;
    return { ...common, status: "ok", retryable: false, data, claims: extractClaims(data), error: digestMatch === false ? "keccak256 of the metadata does not match the onchain metadataDigest" : null };
  }
  if (sawMismatch && last.status !== "integrity_mismatch") last = { ...last, status: "integrity_mismatch", retryable: true };
  return { ...last, attempts };
}

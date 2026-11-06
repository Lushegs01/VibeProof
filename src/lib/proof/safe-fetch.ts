import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import type { TLSSocket } from "node:tls";
import { isPublicIp, validatePublicUrl } from "./url-guard";

export type SafeFetchResult = {
  finalUrl: string;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** Exact bytes received (≤ maxBytes). */
  bytes: Buffer;
  /** true when the response was larger than maxBytes and was cut off. */
  truncated: boolean;
  tls: { valid: boolean; validTo?: string; issuer?: string } | null;
  redirects: string[];
  ms: number;
};

export class SafeFetchError extends Error {
  constructor(
    message: string,
    public kind: "blocked" | "dns" | "network" | "timeout" | "tls" | "too_many_redirects",
  ) {
    super(message);
  }
}

/** DNS lookup that refuses to hand a private/reserved address to the socket (anti-rebinding). */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as (e: Error) => void)(err);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => !isPublicIp(a.address));
    if (bad || !list.length) return (callback as (e: Error) => void)(new SafeFetchError(`Resolved to a non-public address`, "blocked"));
    if ((options as { all?: boolean }).all) return (callback as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    (callback as (e: null, a: string, f: number) => void)(null, list[0].address, list[0].family);
  });
};

/**
 * Fetch an untrusted URL safely: public addresses only (checked at connect time),
 * manual redirect handling with re-validation, strict timeout, capped body size.
 * The request is made directly (not through any configured HTTP proxy) so the IP check is meaningful.
 */
export async function safeFetch(
  input: string,
  opts: {
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    method?: "GET" | "HEAD" | "POST";
    body?: Buffer;
    headers?: Record<string, string>;
    allowHttp?: boolean;
    accept?: string;
  } = {},
): Promise<SafeFetchResult> {
  const {
    timeoutMs = 8_000,
    maxBytes = 512 * 1024,
    maxRedirects = 3,
    method = "GET",
    allowHttp = true,
    accept = "text/html,application/xhtml+xml,*/*;q=0.5",
  } = opts;
  const redirects: string[] = [];
  const started = Date.now();
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const v = validatePublicUrl(current, { allowHttp });
    if (!v.ok) throw new SafeFetchError(v.reason, "blocked");
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw new SafeFetchError("Timed out", "timeout");
    const { location, ...res } = await requestOnce(v.url, method, Math.max(250, remaining), maxBytes, accept, opts.body, opts.headers);
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, v.url).toString();
      redirects.push(next);
      current = next;
      continue;
    }
    return { ...res, finalUrl: v.url.toString(), redirects, ms: Date.now() - started };
  }
  throw new SafeFetchError("Too many redirects", "too_many_redirects");
}

function requestOnce(url: URL, method: string, timeoutMs: number, maxBytes: number, accept: string, body?: Buffer, headers?: Record<string, string>) {
  return new Promise<Omit<SafeFetchResult, "finalUrl" | "redirects" | "ms"> & { location?: string }>((resolve, reject) => {
    // Hard deadline for the whole exchange (socket `timeout` alone only measures idle time, so a
    // slow-drip server could otherwise hold the request open indefinitely).
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      req.destroy(new SafeFetchError("Timed out", "timeout"));
    }, timeoutMs);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method,
        lookup: guardedLookup,
        agent: false,
        timeout: timeoutMs,
        // No accept-encoding: responses arrive uncompressed, so there is nothing to decompress
        // (no decompression bombs) and the byte cap applies to what is actually stored.
        headers: {
          ...headers,
          ...(body ? { "content-length": String(body.length) } : {}),
          "user-agent": "VibeProofBot/0.1 (+https://vibeproof.xyz/bot)",
          accept,
          "accept-encoding": "identity",
        },
      },
      (res) => {
        let tls: SafeFetchResult["tls"] = null;
        if (url.protocol === "https:") {
          const sock = res.socket as TLSSocket;
          const cert = sock.getPeerCertificate?.();
          tls = { valid: sock.authorized !== false, validTo: cert?.valid_to, issuer: cert?.issuer?.O ? String(cert.issuer.O) : undefined };
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (c: Buffer) => {
          if (truncated) return;
          if (size + c.length > maxBytes) {
            chunks.push(c.subarray(0, maxBytes - size));
            size = maxBytes;
            truncated = true;
            res.destroy();
            return;
          }
          size += c.length;
          chunks.push(c);
        });
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          if (timedOut) return reject(new SafeFetchError("Timed out", "timeout"));
          const bytes = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: bytes.toString("utf8"),
            bytes,
            truncated,
            tls,
            location: typeof res.headers.location === "string" ? res.headers.location : undefined,
          });
        };
        res.on("error", () => {
          if (!truncated) {
            clearTimeout(deadline);
            reject(new SafeFetchError("Response stream failed", "network"));
          }
        });
        res.on("end", done);
        res.on("close", () => {
          if (!res.complete && !truncated) {
            clearTimeout(deadline);
            reject(new SafeFetchError("Response ended before completion", "network"));
          } else done();
        });
      },
    );
    req.on("timeout", () => {
      timedOut = true;
      req.destroy(new SafeFetchError("Timed out", "timeout"));
    });
    req.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(deadline);
      if (e instanceof SafeFetchError) return reject(e);
      if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") return reject(new SafeFetchError(`DNS lookup failed (${e.code})`, "dns"));
      if (/certificate|SSL|TLS/i.test(e.message)) return reject(new SafeFetchError(`TLS error: ${e.message}`, "tls"));
      reject(new SafeFetchError(e.message, "network"));
    });
    req.end(body);
  });
}

export function extractPageMeta(html: string) {
  const pick = (re: RegExp) => html.match(re)?.[1]?.trim().replace(/\s+/g, " ").slice(0, 300) ?? null;
  return {
    title: pick(/<title[^>]*>([^<]*)<\/title>/i),
    description:
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ?? pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
    ogTitle: pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i),
  };
}

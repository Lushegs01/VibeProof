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
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; method?: "GET" | "HEAD"; allowHttp?: boolean } = {},
): Promise<SafeFetchResult> {
  const { timeoutMs = 8_000, maxBytes = 512 * 1024, maxRedirects = 3, method = "GET", allowHttp = true } = opts;
  const redirects: string[] = [];
  const started = Date.now();
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const v = validatePublicUrl(current, { allowHttp });
    if (!v.ok) throw new SafeFetchError(v.reason, "blocked");
    const { location, ...res } = await requestOnce(v.url, method, Math.max(1_000, timeoutMs - (Date.now() - started)), maxBytes);
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

function requestOnce(url: URL, method: string, timeoutMs: number, maxBytes: number) {
  return new Promise<Omit<SafeFetchResult, "finalUrl" | "redirects" | "ms"> & { location?: string }>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method,
        lookup: guardedLookup,
        agent: false,
        timeout: timeoutMs,
        headers: { "user-agent": "VibeProofBot/0.1 (+https://vibeproof.xyz/bot)", accept: "text/html,application/xhtml+xml,*/*;q=0.5" },
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
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        const done = () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            tls,
            location: typeof res.headers.location === "string" ? res.headers.location : undefined,
          });
        res.on("end", done);
        res.on("close", done);
      },
    );
    req.on("timeout", () => req.destroy(new SafeFetchError("Timed out", "timeout")));
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e instanceof SafeFetchError) return reject(e);
      if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") return reject(new SafeFetchError(`DNS lookup failed (${e.code})`, "dns"));
      if (/certificate|SSL|TLS/i.test(e.message)) return reject(new SafeFetchError(`TLS error: ${e.message}`, "tls"));
      reject(new SafeFetchError(e.message, "network"));
    });
    req.end();
  });
}

export function extractPageMeta(html: string) {
  const pick = (re: RegExp) => html.match(re)?.[1]?.trim().replace(/\s+/g, " ").slice(0, 300) ?? null;
  return {
    title: pick(/<title[^>]*>([^<]*)<\/title>/i),
    description:
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ??
      pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
    ogTitle: pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i),
  };
}

import { apiTraffic } from "../util/log";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "../cache/ratelimit";
import { isDemoMode } from "../demo/mode";
import { sameOriginRequest } from "../auth/request";
import { redactSecrets } from "../chain/rpc-errors";
import { log, metrics } from "../util/log";

export type ApiMeta = { source: string; observedAt: string; cached: boolean; stale?: boolean; block?: string; demo?: boolean };

export function ok<T>(data: T, meta: ApiMeta, init?: { maxAge?: number; swr?: number; status?: number }) {
  const body = JSON.stringify({ data, meta }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": init?.maxAge ? `public, s-maxage=${init.maxAge}, stale-while-revalidate=${init.swr ?? init.maxAge * 4}` : "no-store",
    },
  });
}

export function fail(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers: { "cache-control": "no-store" } });
}

/** Wrap a route handler with IP rate limiting, latency metrics and uniform error handling. */
export function route<Ctx>(name: string, opts: { limit?: number; windowSec?: number }, handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  const handle = async (req: Request, ctx: Ctx) => {
    const start = performance.now();
    if (
      isDemoMode() &&
      ((!["GET", "HEAD", "OPTIONS"].includes(req.method) && name !== "share") ||
        /^(auth_nonce|watchlist_|notifications|account|developer_keys|webhook_|independent_proof)/.test(name))
    )
      return fail(403, "demo_mode", "Live account and verification operations are disabled in demo mode.");
    const ip = clientIp(req.headers);
    const rl = await rateLimit(`${name}:${ip}`, opts.limit ?? 120, opts.windowSec ?? 60);
    if (rl.unavailable) return fail(503, "rate_limit_unavailable", "Shared request limiting is unavailable. Retry shortly.");
    if (!rl.ok) {
      metrics.inc("api.rate_limited");
      return fail(429, "rate_limited", "Too many requests. Please slow down.", { resetAt: new Date(rl.resetAt).toISOString() });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      try {
        if (!sameOriginRequest(req)) return fail(403, "invalid_origin", "A same-origin request is required.");
      } catch {
        return fail(503, "origin_unconfigured", "Application origin is not configured.");
      }
      if (Number(req.headers.get("content-length") ?? 0) > 65536) return fail(413, "body_too_large", "Request body exceeds 64 KiB.");
      if (req.body) {
        const reader = req.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const remaining = 10000 - (performance.now() - start);
            if (remaining <= 0) {
              await reader.cancel();
              return fail(408, "body_timeout", "Request body timed out.");
            }
            let timer: ReturnType<typeof setTimeout> | undefined;
            let part: ReadableStreamReadResult<Uint8Array>;
            try {
              part = await Promise.race([
                reader.read(),
                new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => reject(new Error("Body timeout")), remaining);
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
            const { done, value } = part;
            if (done) break;
            size += value.length;
            if (size > 65536) {
              await reader.cancel();
              return fail(413, "body_too_large", "Request body exceeds 64 KiB.");
            }
            chunks.push(value);
          }
        } catch {
          void reader.cancel();
          return fail(408, "body_timeout", "Could not read request body before the deadline.");
        }
        req = new Request(req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks), signal: req.signal });
      }
    }
    try {
      const res = await handler(req, ctx);
      res.headers.set("x-ratelimit-remaining", String(rl.remaining));
      return res;
    } catch (e) {
      log("error", "api.error", { route: name, error: redactSecrets(e instanceof Error ? e.message : String(e)) });
      return fail(500, "internal_error", "The request could not be completed.");
    }
  };
  return async (req: Request, ctx: Ctx) => {
    const start = performance.now();
    let response: Response | undefined;
    try {
      response = await handle(req, ctx);
      return response;
    } catch (error) {
      log("error", "api.error", { route: name, error: error instanceof Error ? error.message : String(error) });
      response = fail(500, "internal_error", "The request could not be completed.");
      return response;
    } finally {
      const ms = Math.round(performance.now() - start),
        status = response?.status ?? 500;
      metrics.inc(`api.${name}.calls`);
      metrics.inc(`api.${name}.ms_total`, ms);
      metrics.inc(`api.${name}.status_${status}`);
      if (status >= 500) metrics.inc("api.errors");
      if (status >= 400 && status < 500) metrics.inc(`api.${name}.client_errors`);
      apiTraffic.record({ error: status >= 500, throttled: status === 429, ms });
    }
  };
}

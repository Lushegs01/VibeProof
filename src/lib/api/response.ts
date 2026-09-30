import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "../cache/ratelimit";
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
export function route<Ctx>(
  name: string,
  opts: { limit?: number; windowSec?: number },
  handler: (req: Request, ctx: Ctx) => Promise<Response>,
) {
  return async (req: Request, ctx: Ctx) => {
    const start = performance.now();
    const ip = clientIp(req.headers);
    const rl = await rateLimit(`${name}:${ip}`, opts.limit ?? 120, opts.windowSec ?? 60);
    if (!rl.ok) {
      metrics.inc("api.rate_limited");
      return fail(429, "rate_limited", "Too many requests. Please slow down.", { resetAt: new Date(rl.resetAt).toISOString() });
    }
    try {
      const res = await handler(req, ctx);
      res.headers.set("x-ratelimit-remaining", String(rl.remaining));
      return res;
    } catch (e) {
      metrics.inc("api.errors");
      log("error", "api.error", { route: name, error: e instanceof Error ? e.message : String(e) });
      return fail(500, "internal_error", "The request could not be completed.");
    } finally {
      const ms = Math.round(performance.now() - start);
      metrics.inc(`api.${name}.calls`);
      metrics.inc(`api.${name}.ms_total`, ms);
    }
  };
}

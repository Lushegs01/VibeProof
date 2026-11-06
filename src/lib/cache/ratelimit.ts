import { isIP } from "node:net";
import { getRedis } from "./cache";

/**
 * Fixed-window limiter. Redis INCR+EXPIRE when available (shared across
 * instances); otherwise an in-process window (per instance).
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number; limit: number; unavailable?: boolean };

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const now = Date.now();
  const bucket = Math.floor(now / (windowSec * 1000));
  const resetAt = (bucket + 1) * windowSec * 1000;
  const k = `rl:${key}:${bucket}`;
  const r = getRedis();
  if (r && r.status === "connecting")
    await new Promise<void>((resolve) => {
      const ready = () => {
        clearTimeout(timer);
        r.off("ready", ready);
        resolve();
      };
      const timer = setTimeout(ready, 1000);
      r.once("ready", ready);
    });
  if (r && r.status === "ready") {
    try {
      const output = await r
        .multi()
        .incr(k)
        .expire(k, windowSec + 1)
        .exec();
      if (!output || output.some(([error]) => error)) throw new Error("Redis rate limiter transaction failed");
      const count = Number(output[0][1]);
      if (!Number.isFinite(count)) throw new Error("Invalid limiter count");
      return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt, limit };
    } catch {
      /* fall through */
    }
  }
  if (process.env.NODE_ENV === "production") return { ok: false, remaining: 0, resetAt, limit, unavailable: true };
  if (windows.size >= 10000 && !windows.has(k)) {
    for (const [old, v] of windows) if (v.resetAt <= now) windows.delete(old);
    if (windows.size >= 10000) return { ok: false, remaining: 0, resetAt, limit };
  }
  const w = windows.get(k) ?? { count: 0, resetAt };
  w.count++;
  windows.set(k, w);
  if (windows.size > 10_000) for (const [key2, v] of windows) if (v.resetAt < now) windows.delete(key2);
  return { ok: w.count <= limit, remaining: Math.max(0, limit - w.count), resetAt, limit };
}

export function clientIp(headers: Headers): string {
  // Only trust headers overwritten by the configured ingress. Unknown ingress shares one bucket.
  const candidate =
    process.env.VERCEL === "1"
      ? headers.get("x-vercel-forwarded-for")
      : process.env.TRUST_PROXY === "true"
        ? headers.get("x-forwarded-for")?.split(",").at(-1)?.trim()
        : null;
  return candidate && isIP(candidate) ? candidate : "unknown";
}

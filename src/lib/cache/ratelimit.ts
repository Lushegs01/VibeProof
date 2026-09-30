import { getRedis } from "./cache";

/**
 * Fixed-window limiter. Redis INCR+EXPIRE when available (shared across
 * instances); otherwise an in-process window (per instance).
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number; limit: number };

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const now = Date.now();
  const bucket = Math.floor(now / (windowSec * 1000));
  const resetAt = (bucket + 1) * windowSec * 1000;
  const k = `rl:${key}:${bucket}`;
  const r = getRedis();
  if (r && r.status === "ready") {
    try {
      const [[, count]] = (await r.multi().incr(k).expire(k, windowSec + 1).exec()) as [[unknown, number]];
      return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt, limit };
    } catch {
      /* fall through */
    }
  }
  const w = windows.get(k) ?? { count: 0, resetAt };
  w.count++;
  windows.set(k, w);
  if (windows.size > 10_000) for (const [key2, v] of windows) if (v.resetAt < now) windows.delete(key2);
  return { ok: w.count <= limit, remaining: Math.max(0, limit - w.count), resetAt, limit };
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

import Redis from "ioredis";
import { log, metrics } from "../util/log";
import { dedupe } from "../util/retry";

/**
 * Redis-compatible cache with an in-process fallback. Values are JSON with
 * bigint support. `cached()` implements stale-while-revalidate: a stale hit
 * is served immediately and refreshed in the background.
 */
type Entry = { v: unknown; freshUntil: number; staleUntil: number };

const g = globalThis as unknown as { __vpRedis?: Redis | null; __vpMem?: Map<string, Entry> };
const mem = (g.__vpMem ??= new Map());

export function getRedis(): Redis | null {
  if (g.__vpRedis !== undefined) return g.__vpRedis;
  // REDIS_URL, or KV_URL as injected by Vercel's Upstash/KV integration (rediss:// works with ioredis).
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) return (g.__vpRedis = null);
  const r = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  r.on("error", (e) => log("warn", "redis.error", { error: e.message }));
  return (g.__vpRedis = r);
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? { __bigint: v.toString() } : v);
const reviver = (_k: string, v: unknown) =>
  v && typeof v === "object" && "__bigint" in (v as object) ? BigInt((v as { __bigint: string }).__bigint) : v;

async function read(key: string): Promise<Entry | null> {
  const r = getRedis();
  if (r && r.status === "ready") {
    try {
      const s = await r.get(key);
      return s ? (JSON.parse(s, reviver) as Entry) : null;
    } catch {
      /* fall through to memory */
    }
  }
  const e = mem.get(key);
  if (e && e.staleUntil < Date.now()) {
    mem.delete(key);
    return null;
  }
  return e ?? null;
}

async function write(key: string, e: Entry) {
  const r = getRedis();
  const ttl = Math.max(1, Math.ceil((e.staleUntil - Date.now()) / 1000));
  if (r && r.status === "ready") {
    try {
      await r.set(key, JSON.stringify(e, replacer), "EX", ttl);
      return;
    } catch {
      /* fall through */
    }
  }
  if (mem.size > 5_000) mem.delete(mem.keys().next().value!);
  mem.set(key, e);
}

export async function invalidate(key: string) {
  mem.delete(key);
  const r = getRedis();
  if (r && r.status === "ready") await r.del(key).catch(() => {});
}

export async function cached<T>(
  key: string,
  opts: { ttl: number; swr?: number },
  fn: () => Promise<T>,
): Promise<{ value: T; cached: boolean; stale: boolean }> {
  const now = Date.now();
  const hit = await read(key);
  const refresh = () =>
    dedupe(`cache:${key}`, async () => {
      const v = await fn();
      await write(key, { v, freshUntil: Date.now() + opts.ttl * 1000, staleUntil: Date.now() + (opts.ttl + (opts.swr ?? 0)) * 1000 });
      return v;
    });
  if (hit && hit.freshUntil > now) {
    metrics.inc("cache.hit");
    return { value: hit.v as T, cached: true, stale: false };
  }
  if (hit && hit.staleUntil > now) {
    metrics.inc("cache.stale");
    refresh().catch((e) => log("warn", "cache.revalidate_failed", { key, error: String(e) }));
    return { value: hit.v as T, cached: true, stale: true };
  }
  metrics.inc("cache.miss");
  return { value: await refresh(), cached: false, stale: false };
}

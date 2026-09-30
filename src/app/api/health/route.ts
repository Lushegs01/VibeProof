import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getRedis } from "@/lib/cache/cache";
import { getProvider } from "@/lib/chain/provider";
import { activityCursor } from "@/lib/services/token-service";
import { metrics } from "@/lib/util/log";

export const dynamic = "force-dynamic";

async function probe<T>(fn: () => Promise<T>): Promise<["ok", T, number] | ["error", string, number]> {
  const t = performance.now();
  try {
    return ["ok", await fn(), Math.round(performance.now() - t)];
  } catch (e) {
    return ["error", e instanceof Error ? e.message.slice(0, 120) : String(e), Math.round(performance.now() - t)];
  }
}

export async function GET() {
  const db = getDb();
  const redis = getRedis();
  const [dbR, redisR, rpcR, idxR] = await Promise.all([
    db ? probe(() => db.execute(sql`select 1`)) : Promise.resolve(["error", "DATABASE_URL not set", 0] as const),
    redis ? probe(() => redis.ping()) : Promise.resolve(["error", "REDIS_URL not set (in-memory fallback active)", 0] as const),
    probe(() => getProvider().getBlockNumber()),
    db ? probe(() => activityCursor()) : Promise.resolve(["error", "no database", 0] as const),
  ]);
  const latest = rpcR[0] === "ok" ? Number(rpcR[1]) : null;
  const indexed = idxR[0] === "ok" && idxR[1] !== null ? Number(idxR[1]) : null;
  const lag = latest !== null && indexed !== null ? latest - indexed : null;
  const indexer = idxR[0] === "error" ? "error" : indexed === null ? "not_started" : lag !== null && lag > 2_000 ? "lagging" : "ok";
  const body = {
    database: dbR[0],
    redis: redisR[0],
    rpc: rpcR[0],
    indexer,
    latestBlock: latest,
    indexedThrough: indexed,
    lagBlocks: lag,
    latencyMs: { database: dbR[2], redis: redisR[2], rpc: rpcR[2] },
    errors: Object.fromEntries(
      [["database", dbR], ["redis", redisR], ["rpc", rpcR], ["indexer", idxR]].filter(([, r]) => (r as unknown[])[0] === "error").map(([k, r]) => [k, (r as unknown[])[1]]),
    ),
    metrics: metrics.snapshot(),
  };
  const healthy = body.database === "ok" && body.rpc === "ok";
  return NextResponse.json(body, { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } });
}

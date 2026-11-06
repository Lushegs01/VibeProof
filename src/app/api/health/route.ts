import { isDemoMode } from "@/lib/demo/mode";
import { NextResponse } from "next/server";
import { healthReport } from "@/lib/services/health-service";
import { cronAuthorized } from "@/lib/auth/cron";
import { rateLimit, clientIp } from "@/lib/cache/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Operational status: database, Redis, RPC (with eth_chainId check) and, per network, the
 * indexer's cursors, lag, queue sizes, heartbeat times, provider error rate and configured
 * deployments. Designed to diagnose a completely empty database. Never fabricates a status:
 * if a value cannot be read it is reported as an error/unavailable.
 */
export async function GET(req: Request) {
  if (isDemoMode()) return NextResponse.json({ status: "demo", demo: true, indexer: { status: "unavailable" } }, { headers: { "cache-control": "no-store" } });
  // Health makes a few RPC + DB calls; keep it cheap to call but not free to hammer.
  if (!(await rateLimit(`health:${clientIp(req.headers)}`, 30, 60)).ok)
    return NextResponse.json({ error: { code: "rate_limited", message: "Too many health checks." } }, { status: 429 });
  const { body, httpStatus } = await healthReport();
  const publicBody = {
    status: body.status,
    demo: body.demo,
    activeNetwork: body.activeNetwork,
    chain: body.chain,
    chainId: body.chainId,
    database: body.database,
    redis: body.redis,
    rpc: body.rpc,
    latestBlock: body.latestBlock,
    indexedThrough: body.indexedThrough,
    lagBlocks: body.lagBlocks,
    indexer: { status: body.indexer.status },
    checkedAt: body.checkedAt,
  };
  return NextResponse.json(cronAuthorized(req) ? body : publicBody, { status: httpStatus, headers: { "cache-control": "no-store" } });
}

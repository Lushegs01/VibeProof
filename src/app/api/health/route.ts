import { NextResponse } from "next/server";
import { healthReport } from "@/lib/services/health-service";
import { rateLimit, clientIp } from "@/lib/cache/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Operational status: database, Redis, RPC (with eth_chainId check) and, per network, the
 * indexer's cursors, lag, queue sizes, heartbeat times, provider error rate and configured
 * deployments. Designed to diagnose a completely empty database. Never fabricates a status:
 * if a value cannot be read it is reported as an error/unavailable.
 */
export async function GET(req: Request) {
  // Health makes a few RPC + DB calls; keep it cheap to call but not free to hammer.
  if (!(await rateLimit(`health:${clientIp(req.headers)}`, 30, 60)).ok) return NextResponse.json({ error: { code: "rate_limited", message: "Too many health checks." } }, { status: 429 });
  const { body, httpStatus } = await healthReport();
  return NextResponse.json(body, { status: httpStatus, headers: { "cache-control": "no-store" } });
}

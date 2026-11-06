import { and, desc, eq, sql } from "drizzle-orm";
import { route, ok, fail } from "@/lib/api/response";
import { baseMeta, networkParam } from "@/lib/api/params";
import { serviceNetwork } from "@/lib/services/network";
import { accountApiRequest } from "@/lib/developer/api";
import { getDb, schema } from "@/lib/db/client";
import { isDemoMode } from "@/lib/demo/mode";
import { ProofError } from "@/lib/services/proof-service";
export const GET = route("v1_discover", { limit: 60 }, async (req) => {
  const n = networkParam(req);
  if ("error" in n) return n.error;
  const query = new URL(req.url).searchParams,
    limit = Number(query.get("limit") ?? 50),
    before = Number(query.get("before") ?? 2147483647);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(before) || before < 1)
    return fail(400, "invalid_pagination", "limit must be 1–100; before must be a positive launch ID.");
  const net = serviceNetwork(n.network),
    db = getDb();
  if (!db || isDemoMode()) return fail(503, "data_unavailable", "Live launch discovery is unavailable.");
  try {
    await accountApiRequest(req);
    const conditions = [eq(schema.launches.chainId, net.chainId), sql`${schema.launches.id}<${before}`];
    const status = query.get("status");
    if (status) {
      if (!["bonding", "curve_completed", "graduated"].includes(status)) return fail(400, "invalid_status", "Unknown launch status.");
      conditions.push(eq(schema.launches.status, status));
    }
    const items = await db
      .select({
        id: schema.launches.id,
        chainId: schema.launches.chainId,
        token: schema.launches.tokenAddress,
        creator: schema.launches.creatorAddress,
        status: schema.launches.status,
        launchedAt: schema.launches.createdAt,
        txHash: schema.launches.txHash,
        block: schema.launches.blockNumber,
        timestampExact: schema.launches.createdAtExact,
      })
      .from(schema.launches)
      .where(and(...conditions))
      .orderBy(desc(schema.launches.id))
      .limit(limit);
    return ok(
      { items, nextBefore: items.length === limit ? items.at(-1)!.id : null },
      baseMeta("Indexed launchpad factory events; timestamps may be interpolated as marked"),
    );
  } catch (e) {
    if (e instanceof ProofError) return fail(e.status, e.code, e.message);
    throw e;
  }
});

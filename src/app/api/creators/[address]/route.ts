import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, networkParam, type AddrCtx } from "@/lib/api/params";
import { getCreatorPassport } from "@/lib/services/creator-service";

export const GET = route<AddrCtx>("creator", { limit: 120 }, async (req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  const n = networkParam(req);
  if ("error" in n) return n.error;
  const { creator, cached } = await getCreatorPassport(p.address, n.network);
  if (!creator) return fail(404, "not_found", `No launches observed from this wallet on ${n.network}.`);
  return ok(creator, baseMeta("VibeProof indexer", cached), { maxAge: 30 });
});

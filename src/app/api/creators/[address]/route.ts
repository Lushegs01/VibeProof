import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, type AddrCtx } from "@/lib/api/params";
import { getCreatorPassport } from "@/lib/services/creator-service";

export const GET = route<AddrCtx>("creator", { limit: 120 }, async (_req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  const { creator, cached } = await getCreatorPassport(p.address);
  if (!creator) return fail(404, "not_found", "No vibe/vibe launches observed from this wallet.");
  return ok(creator, baseMeta("VibeProof indexer", cached), { maxAge: 30 });
});

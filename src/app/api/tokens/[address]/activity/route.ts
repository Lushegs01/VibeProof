import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, type AddrCtx } from "@/lib/api/params";
import { getTokenPassport } from "@/lib/services/token-service";

export const GET = route<AddrCtx>("token_activity", { limit: 120 }, async (_req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  const { passport, cached } = await getTokenPassport(p.address);
  if (!passport) return fail(404, "not_found", "Token not found.");
  return ok({ metrics: passport.activity, recent: passport.recent, indexer: passport.indexer }, { ...baseMeta("VibeProof indexer", cached), block: passport.indexer.indexedThrough ?? undefined }, { maxAge: 10 });
});

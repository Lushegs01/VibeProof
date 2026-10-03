import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, networkParam, type AddrCtx } from "@/lib/api/params";
import { getTokenPassport } from "@/lib/services/token-service";

export const GET = route<AddrCtx>("token", { limit: 120 }, async (req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  const n = networkParam(req);
  if ("error" in n) return n.error;
  const { passport, cached } = await getTokenPassport(p.address, { network: n.network });
  if (!passport) return fail(404, "not_found", `No contract bytecode at this address on ${n.network}.`);
  return ok(passport, { ...baseMeta(`${passport.chainName} RPC + VibeProof indexer + Blockscout`, cached), block: passport.contract.block }, { maxAge: 15 });
});

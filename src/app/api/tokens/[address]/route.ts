import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, type AddrCtx } from "@/lib/api/params";
import { getTokenPassport } from "@/lib/services/token-service";

export const GET = route<AddrCtx>("token", { limit: 120 }, async (_req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  const { passport, cached } = await getTokenPassport(p.address);
  if (!passport) return fail(404, "not_found", "No contract bytecode at this address on Robinhood Chain Testnet.");
  return ok(passport, { ...baseMeta("Robinhood Chain Testnet RPC + VibeProof indexer + Blockscout", cached), block: passport.contract.block }, { maxAge: 15 });
});

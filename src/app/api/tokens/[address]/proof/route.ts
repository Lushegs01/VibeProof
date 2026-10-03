import { route, ok } from "@/lib/api/response";
import { addressParam, baseMeta, networkParam, type AddrCtx } from "@/lib/api/params";
import { getProofSection } from "@/lib/services/token-service";
import { isDemoMode } from "@/lib/demo/mode";
import { demoPassport } from "@/lib/demo/data";

export const GET = route<AddrCtx>("token_proof", { limit: 120 }, async (req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  const n = networkParam(req);
  if ("error" in n) return n.error;
  const proof = isDemoMode() ? demoPassport(p.address)?.proof ?? null : await getProofSection(p.address, n.network);
  return ok(proof, baseMeta("VibeProof proof checks"), { maxAge: 15 });
});

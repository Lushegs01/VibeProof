import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, type AddrCtx } from "@/lib/api/params";
import { getContractAnalysis, invalidatePassport } from "@/lib/services/token-service";
import { rateLimit, clientIp } from "@/lib/cache/ratelimit";
import { isDemoMode } from "@/lib/demo/mode";
import { demoPassport } from "@/lib/demo/data";

export const GET = route<AddrCtx>("token_contract", { limit: 120 }, async (req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  if (isDemoMode()) {
    const d = demoPassport(p.address);
    return d ? ok(d.contract, baseMeta("DEMO DATA")) : fail(404, "not_found", "Unknown demo token.");
  }
  let refresh = new URL(req.url).searchParams.get("refresh") === "1";
  // Forced re-analysis is expensive: 1 per token per 5 minutes per IP.
  if (refresh && !(await rateLimit(`refresh:${clientIp(req.headers)}:${p.address}`, 1, 300)).ok) refresh = false;
  const analysis = await getContractAnalysis(p.address, { refresh });
  if (!analysis.basics.exists) return fail(404, "not_found", "No contract bytecode at this address.");
  if (refresh) await invalidatePassport(p.address);
  return ok(analysis, { ...baseMeta("Robinhood Chain Testnet RPC + Blockscout"), block: analysis.block }, { maxAge: 60 });
});

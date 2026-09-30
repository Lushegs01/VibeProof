import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, type AddrCtx } from "@/lib/api/params";
import { getTokenPassport } from "@/lib/services/token-service";

/** Developer API v1 — stable subset of the passport, CORS-enabled. */
export const GET = route<AddrCtx>("v1_token", { limit: 60 }, async (_req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  const { passport, cached } = await getTokenPassport(p.address);
  if (!passport) return fail(404, "not_found", "No contract at this address.");
  const res = ok(
    {
      address: passport.address,
      chainId: passport.chainId,
      name: passport.name,
      symbol: passport.symbol,
      isVibeLaunch: passport.isVibeLaunch,
      createdAt: passport.createdAt,
      creator: passport.creator?.address ?? null,
      contract: { sourceVerified: passport.contract.sourceVerified, proxy: passport.contract.proxy.kind, owner: passport.contract.owner, checks: passport.contract.checks.map((c) => ({ id: c.id, status: c.status, state: c.state, value: c.value ?? null })) },
      product: { observed: passport.proof.score.observed, total: passport.proof.score.total, checks: passport.proof.checks.map((c) => ({ type: c.type, state: c.state, url: c.url })) },
      activity: Object.fromEntries(Object.entries(passport.activity).map(([k, v]) => [k, { value: v.value, state: v.state }])),
    },
    { ...baseMeta("VibeProof", cached), block: passport.contract.block },
    { maxAge: 30 },
  );
  res.headers.set("access-control-allow-origin", "*");
  return res;
});

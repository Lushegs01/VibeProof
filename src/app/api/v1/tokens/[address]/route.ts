import { accountApiRequest } from "@/lib/developer/api";
import { ProofError } from "@/lib/services/proof-service";
import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, networkParam, type AddrCtx } from "@/lib/api/params";
import { getTokenPassport } from "@/lib/services/token-service";

/** Developer API v1 — stable subset of the passport, CORS-enabled. */
export const GET = route<AddrCtx>("v1_token", { limit: 60 }, async (req, ctx) => {
  let usage;
  try {
    usage = await accountApiRequest(req);
  } catch (e) {
    if (e instanceof ProofError) return fail(e.status, e.code, e.message);
    throw e;
  }
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  const n = networkParam(req);
  if ("error" in n) return n.error;
  const { passport, cached } = await getTokenPassport(p.address, { network: n.network });
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
      contract: {
        sourceVerified: passport.contract.sourceVerified,
        proxy: passport.contract.proxy.kind,
        owner: passport.contract.owner,
        checks: passport.contract.checks.map((c) => ({ id: c.id, status: c.status, state: c.state, value: c.value ?? null })),
      },
      product: {
        observed: passport.proof.score.observed,
        total: passport.proof.score.total,
        checks: passport.proof.checks.map((c) => ({
          type: c.type,
          state: c.state,
          assurance: c.assurance,
          expiresAt: c.expiresAt,
          url: c.url,
          evidence: c.evidence,
        })),
      },
      activity: Object.fromEntries(Object.entries(passport.activity).map(([k, v]) => [k, { value: v.value, state: v.state, source: v.evidence.source }])),
      coverage: { status: passport.coverage.status, indexedThrough: passport.coverage.indexedThrough },
      launch: passport.launch
        ? {
            launchpad: passport.launch.launchpad,
            deployment: passport.launch.deploymentId,
            txHash: passport.launch.txHash,
            block: passport.launch.blockNumber,
            status: passport.launch.status,
          }
        : null,
    },
    { ...baseMeta("VibeProof", cached), block: passport.contract.block },
    { maxAge: 30 },
  );
  if (usage) {
    res.headers.set("cache-control", "no-store");
    res.headers.set("x-usage-monthly", String(usage.used));
    res.headers.set("x-quota-monthly", String(usage.limit));
  }
  res.headers.set("access-control-allow-origin", "*");
  return res;
});

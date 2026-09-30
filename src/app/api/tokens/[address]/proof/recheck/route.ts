import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, type AddrCtx } from "@/lib/api/params";
import { recheckProof, ProofError } from "@/lib/services/proof-service";
import { rateLimit } from "@/lib/cache/ratelimit";

export const POST = route<AddrCtx>("proof_recheck", { limit: 10 }, async (_req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  // Global per-token limit: re-checks hit third-party sites, so at most 1 per 10 minutes.
  if (!(await rateLimit(`recheck:${p.address}`, 1, 600)).ok) return fail(429, "rate_limited", "This proof was re-checked recently. Try again in a few minutes.");
  try {
    return ok(await recheckProof(p.address), baseMeta("VibeProof proof checks"));
  } catch (e) {
    if (e instanceof ProofError) return fail(e.status, e.code, e.message);
    throw e;
  }
});

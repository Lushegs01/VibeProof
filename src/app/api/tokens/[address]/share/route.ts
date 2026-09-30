import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, type AddrCtx } from "@/lib/api/params";
import { getOrCreateShareId } from "@/lib/services/share-service";
import { getTokenPassport } from "@/lib/services/token-service";

export const POST = route<AddrCtx>("share", { limit: 30 }, async (_req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  const { passport } = await getTokenPassport(p.address);
  if (!passport) return fail(404, "not_found", "Token not found.");
  const id = await getOrCreateShareId(p.address);
  if (!id) return fail(503, "unavailable", "Share links require a database.");
  return ok({ id, path: `/p/${id}` }, baseMeta("VibeProof"));
});

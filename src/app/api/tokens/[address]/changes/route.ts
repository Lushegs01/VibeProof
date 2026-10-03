import { route, ok, fail } from "@/lib/api/response";
import { addressParam, baseMeta, networkParam, type AddrCtx } from "@/lib/api/params";
import { getChanges } from "@/lib/services/changes-service";

export const GET = route<AddrCtx>("token_changes", { limit: 120 }, async (req, ctx) => {
  const p = await addressParam(ctx);
  if ("error" in p) return p.error;
  const n = networkParam(req);
  if ("error" in n) return n.error;
  const raw = new URL(req.url).searchParams.get("since");
  const since = raw ? new Date(raw) : new Date(Date.now() - 24 * 3600_000);
  if (Number.isNaN(+since) || +since > Date.now()) return fail(400, "invalid_since", "`since` must be an ISO timestamp in the past.");
  const changes = await getChanges(p.address, since, n.network);
  if (!changes) return fail(404, "not_found", "No indexed history for this token.");
  return ok(changes, baseMeta("VibeProof snapshots"), { maxAge: 10 });
});

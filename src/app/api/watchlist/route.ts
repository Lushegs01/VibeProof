import { z } from "zod";
import { route, ok, fail } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { sessionWallet } from "@/lib/auth/request";
import { listWatched, updateWatched } from "@/lib/services/watchlist-service";
import { ProofError } from "@/lib/services/proof-service";
const body = z.object({
  chainId: z.union([z.literal(46630), z.literal(4663)]),
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  action: z.enum(["add", "remove", "checked"]),
});
export const GET = route("watchlist_get", {}, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in to access your wallet watchlist.");
  try {
    return ok(await listWatched(wallet.toLowerCase()), baseMeta("Authenticated wallet watchlist"));
  } catch (e) {
    if (e instanceof ProofError) return fail(e.status, e.code, e.message);
    throw e;
  }
});
export const POST = route("watchlist_write", { limit: 60 }, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in to update your watchlist.");
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return fail(400, "invalid_body", "Expected chainId, token, and add/remove/checked action.");
  try {
    await updateWatched(wallet.toLowerCase(), input.data.chainId, input.data.token.toLowerCase(), input.data.action);
    return ok({ updated: true }, baseMeta("Wallet watchlist"));
  } catch (e) {
    if (e instanceof ProofError) return fail(e.status, e.code, e.message);
    throw e;
  }
});

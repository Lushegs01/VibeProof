import { route, ok, fail } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { sessionWallet } from "@/lib/auth/request";
import { watchNotifications } from "@/lib/services/watchlist-service";
export const GET = route("notifications", {}, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in to read notifications.");
  const offset = Number(new URL(req.url).searchParams.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return fail(400, "invalid_offset", "offset must be between 0 and 10000.");
  const items = await watchNotifications(wallet.toLowerCase(), offset, 50);
  return ok({ items, nextOffset: items.length === 50 ? offset + 50 : null }, baseMeta("Significant changes for watched network assets"));
});

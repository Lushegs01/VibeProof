import { route, ok } from "@/lib/api/response";
import { baseMeta, networkParam } from "@/lib/api/params";
import { activityFeed } from "@/lib/services/discover-service";

export const GET = route("feed", { limit: 120 }, async (req) => {
  const n = networkParam(req);
  if ("error" in n) return n.error;
  return ok(await activityFeed(60, n.network), baseMeta("VibeProof indexer"), { maxAge: 5 });
});

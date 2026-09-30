import { route, ok, fail } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { search } from "@/lib/services/search-service";

export const GET = route("search", { limit: 60 }, async (req) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length > 100) return fail(400, "query_too_long", "Query must be 100 characters or fewer.");
  return ok(await search(q), baseMeta("VibeProof index + RPC"), { maxAge: 10 });
});

import { route, ok } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { discover, SORTS, CATEGORIES, type SortKey, type CategoryKey } from "@/lib/services/discover-service";

export const GET = route("discover", { limit: 120 }, async (req) => {
  const sp = new URL(req.url).searchParams;
  const sort = (sp.get("sort") ?? "newest") as SortKey;
  const category = (sp.get("category") ?? "all") as CategoryKey;
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") ?? 50) || 50));
  const s = sort in SORTS ? sort : "newest";
  const c = category in CATEGORIES ? category : "all";
  const { items, cached } = await discover(s, c, limit);
  return ok({ sort: s, sortExplanation: SORTS[s].explain, category: c, items }, baseMeta("VibeProof indexer", cached), { maxAge: 15 });
});

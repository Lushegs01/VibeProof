import { route, ok } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { activityFeed } from "@/lib/services/discover-service";

export const GET = route("feed", { limit: 120 }, async () => ok(await activityFeed(60), baseMeta("VibeProof indexer"), { maxAge: 5 }));

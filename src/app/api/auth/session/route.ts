import { route, ok } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { sessionWallet } from "@/lib/auth/request";

export const GET = route("auth_session", { limit: 120 }, async (req) => ok({ address: await sessionWallet(req) }, baseMeta("VibeProof")));

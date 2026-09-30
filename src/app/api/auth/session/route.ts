import { route, ok } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { readCookie, readSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

export const GET = route("auth_session", { limit: 120 }, async (req) => ok({ address: readSessionToken(readCookie(req, SESSION_COOKIE)) }, baseMeta("VibeProof")));

import { route, ok } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { revokeSession } from "@/lib/auth/request";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const POST = route("auth_logout", { limit: 30 }, async (req) => {
  await revokeSession(req);
  const res = ok({ ok: true }, baseMeta("VibeProof"));
  res.headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
});

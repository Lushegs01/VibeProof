import { z } from "zod";
import { route, ok, fail } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { applicationOrigin } from "@/lib/auth/request";
import { verifySiwe } from "@/lib/auth/siwe";
import { createSessionToken, sessionCookie } from "@/lib/auth/session";

const Body = z.object({
  message: z.string().min(1).max(4096),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .max(20_000),
});

export const POST = route("auth_verify", { limit: 20 }, async (req) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_body", "Expected { message, signature }.");
  const host = new URL(applicationOrigin(req)).host;
  const res = await verifySiwe(parsed.data.message, parsed.data.signature as `0x${string}`, host);
  if (!res.ok) return fail(401, "invalid_siwe", res.reason);
  const response = ok({ address: res.address }, baseMeta("SIWE"));
  response.headers.append("set-cookie", sessionCookie(createSessionToken(res.address)));
  return response;
});

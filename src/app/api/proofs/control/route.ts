import { z } from "zod";
import { getAddress } from "viem";
import { route, ok, fail } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { sessionWallet } from "@/lib/auth/request";
import { issueControlChallenge, verifyControlChallenge } from "@/lib/proof/challenges";
import { ProofError } from "@/lib/services/proof-service";
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("issue"), token: z.string().regex(/^0x[0-9a-fA-F]{40}$/), kind: z.enum(["website", "github"]), target: z.string().max(500) }),
  z.object({ action: z.literal("verify"), id: z.string().uuid() }),
]);
export const POST = route("control_challenge", { limit: 10, windowSec: 3600 }, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in with the creator wallet.");
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return fail(400, "invalid_body", "Expected an issue or verify control challenge request.");
  try {
    const p = input.data;
    return ok(
      p.action === "issue"
        ? await issueControlChallenge(wallet, getAddress(p.token.toLowerCase()), p.kind, p.target)
        : await verifyControlChallenge(wallet, p.id),
      baseMeta("Authenticated creator and published control challenge"),
    );
  } catch (e) {
    if (e instanceof ProofError) return fail(e.status, e.code, e.message);
    throw e;
  }
});

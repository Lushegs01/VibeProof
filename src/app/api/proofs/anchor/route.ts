import { z } from "zod";
import { route, ok, fail } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { recordAnchor, ProofError } from "@/lib/services/proof-service";
import { getAddress } from "viem";
import { activeNetwork } from "@/lib/chain/networks";

const Body = z.object({ token: z.string().regex(/^0x[0-9a-fA-F]{40}$/), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

export const POST = route("proofs_anchor", { limit: 20 }, async (req) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_body", "Expected { token, txHash }.");
  try {
    return ok(await recordAnchor(getAddress(parsed.data.token.toLowerCase()), parsed.data.txHash as `0x${string}`), baseMeta(`${activeNetwork().name} RPC (receipt)`));
  } catch (e) {
    if (e instanceof ProofError) return fail(e.status, e.code, e.message);
    throw e;
  }
});

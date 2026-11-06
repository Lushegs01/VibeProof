import { getAddress, type Hash } from "viem";
import { z } from "zod";
import { route, ok, fail } from "@/lib/api/response";
import { baseMeta, networkParam } from "@/lib/api/params";
import { verifyProof, ProofVerificationError } from "@/lib/proof/verify";
import { getProvider } from "@/lib/chain/provider";
import { serviceNetwork } from "@/lib/services/network";
const query = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  creator: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  launchTx: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});
export const GET = route("independent_proof", { limit: 10 }, async (req) => {
  const net = networkParam(req);
  if ("error" in net) return net.error;
  const network = serviceNetwork(net.network);
  const input = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!input.success) return fail(400, "invalid_query", "Supply txHash, token, creator, and optional launchTx.");
  // Registry configuration is network-specific; never reuse a testnet registry on mainnet.
  const registry = network.slug === "robinhood-mainnet" ? process.env.ROBINHOOD_MAINNET_REGISTRY_ADDRESS : process.env.NEXT_PUBLIC_REGISTRY_ADDRESS;
  if (!registry) return fail(503, "registry_unconfigured", "No registry configured for this network.");
  const confirmations = Number(process.env.PROOF_CONFIRMATIONS ?? 12);
  if (!Number.isSafeInteger(confirmations) || confirmations < 1) return fail(503, "invalid_finality", "Invalid confirmation policy.");
  try {
    const result = await verifyProof(
      {
        ...input.data,
        txHash: input.data.txHash as Hash,
        launchTx: input.data.launchTx as Hash | undefined,
        token: getAddress(input.data.token.toLowerCase()),
        creator: getAddress(input.data.creator.toLowerCase()),
        registry: getAddress(registry),
        chainId: network.chainId,
        confirmations: BigInt(confirmations),
      },
      getProvider(network.slug),
    );
    return ok(result, baseMeta("Public blockchain and exact committed document bytes"));
  } catch (e) {
    if (e instanceof ProofVerificationError)
      return fail(["pending", "unconfirmed"].includes(e.code) ? 409 : e.code === "content_unavailable" ? 503 : 422, e.code, e.message);
    throw e;
  }
});

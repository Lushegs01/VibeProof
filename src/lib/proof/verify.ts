import { decodeEventLog, keccak256, type Address, type Hash, type Log } from "viem";
import { assertChainId, type ChainProvider } from "../chain/provider";
import { REGISTRY_ABI } from "../registry/abi";
import { launchpadAdapters } from "../launchpads/registry";
import { parseCanonicalProof } from "./metadata";
import { retrieveEvidence } from "./storage";

export type VerificationInput = { txHash: Hash; registry: Address; token: Address; creator: Address; chainId: number; confirmations: bigint; launchTx?: Hash };
export class ProofVerificationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const reject = (code: string, message: string): never => {
  throw new ProofVerificationError(code, message);
};
/** No database access: receipt, canonical block, current registry record, and immutable bytes only. */
export async function verifyProof(input: VerificationInput, provider: ChainProvider, retrieve = retrieveEvidence) {
  const { registry, token, creator, chainId, txHash } = input;
  if (provider.chainId !== chainId) reject("wrong_network", "Verifier is configured for a different network.");
  await assertChainId(provider);
  if (input.confirmations < 1n) reject("invalid_finality", "At least one confirmation is required.");
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) reject("pending", "Anchoring transaction is unavailable or pending.");
  if (receipt!.status !== "success") reject("reverted", "Anchoring transaction reverted.");
  const head = await provider.getBlockNumber();
  const confirmations = head - receipt!.blockNumber + 1n;
  if (confirmations < input.confirmations) reject("unconfirmed", "Anchoring transaction has not met the configured confirmation policy.");
  const block = await provider.getBlock({ blockNumber: receipt!.blockNumber });
  if (block.hash !== receipt!.blockHash) reject("reorganized", "Anchoring receipt is no longer in the canonical chain.");
  const events = receipt!.logs
    .flatMap((log) => {
      if (log.address.toLowerCase() !== registry.toLowerCase()) return [];
      try {
        const ev = decodeEventLog({ abi: REGISTRY_ABI, data: log.data, topics: log.topics as never });
        return ev.eventName === "ProofSubmitted" || ev.eventName === "ProofUpdated" ? [ev.args] : [];
      } catch {
        return [];
      }
    })
    .filter((ev) => ev.creator.toLowerCase() === creator.toLowerCase() && ev.token.toLowerCase() === token.toLowerCase());
  if (events.length !== 1) reject("no_matching_event", "Expected exactly one registry event for this creator and token.");
  const event = events[0];
  const current = await provider.readContract<{ metadataHash: Hash; metadataURI: string }>({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "getProof",
    args: [creator, token],
  });
  const historical = current.metadataHash !== event.metadataHash || current.metadataURI !== event.metadataURI;
  let bytes: Uint8Array;
  try {
    bytes = await retrieve(event.metadataURI);
  } catch {
    return reject("content_unavailable", "Committed evidence bytes could not be retrieved. Legacy mutable URLs may no longer contain the original document.");
  }
  const hash = keccak256(bytes!);
  if (hash !== event.metadataHash) reject("hash_mismatch", "Document bytes do not match the on-chain commitment.");
  let doc: ReturnType<typeof parseCanonicalProof>;
  try {
    doc = parseCanonicalProof(bytes!);
  } catch {
    return reject("malformed_document", "Committed document is not a supported canonical v1 evidence document.");
  }
  if (doc!.chainId !== chainId || doc!.token !== token.toLowerCase() || doc!.creator !== creator.toLowerCase())
    reject("relationship_mismatch", "Document network, token or creator differs from the registry event.");
  let authority: "launch_creator" | "unverified" = "unverified";
  if (input.launchTx) {
    const launch = await provider.getTransactionReceipt(input.launchTx);
    if (!launch || launch.status !== "success") reject("launch_unavailable", "Launch transaction unavailable or reverted.");
    const launchBlock = await provider.getBlock({ blockNumber: launch!.blockNumber });
    if (launchBlock.hash !== launch!.blockHash || head - launch!.blockNumber + 1n < input.confirmations)
      reject("launch_unconfirmed", "Launch receipt is reorganized or insufficiently confirmed.");
    for (const adapter of launchpadAdapters(chainId))
      for (const log of launch!.logs) {
        const deployment = adapter.isFactory(log.address);
        if (!deployment) continue;
        const decoded = adapter.decodeLaunch(log as unknown as Log, deployment);
        if (decoded?.token.toLowerCase() === token.toLowerCase() && decoded.creator.toLowerCase() === creator.toLowerCase()) authority = "launch_creator";
      }
    if (authority !== "launch_creator") reject("creator_mismatch", "Launch receipt does not identify this wallet as this token’s creator.");
  }
  // Recheck after external retrieval to catch a reorg during verification.
  if ((await provider.getBlock({ blockNumber: receipt!.blockNumber })).hash !== receipt!.blockHash)
    reject("reorganized", "Chain changed while verifying. Retry verification.");
  return {
    status: historical ? "historical_verified" : "cryptographically_verified",
    creatorAuthority: authority,
    registry,
    txHash,
    token,
    creator,
    chainId,
    metadataUri: event.metadataURI,
    metadataHash: hash,
    blockNumber: receipt!.blockNumber.toString(),
    confirmations: confirmations.toString(),
    requiredConfirmations: input.confirmations.toString(),
    checkedAt: new Date().toISOString(),
    explanation: `Exact evidence bytes match this creator’s on-chain commitment.${historical ? " A newer record has replaced this commitment." : ""}${authority === "unverified" ? " Creator authority has not been independently established; supply launchTx to check the launch event." : " Creator matches the supplied factory launch receipt."} This does not certify safety or the truth of submitted claims.`,
  };
}

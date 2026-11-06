import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, toBytes, type Address } from "viem";
import { REGISTRY_ABI } from "@/lib/registry/abi";
import { canonicalProofMetadata, parseCanonicalProof } from "@/lib/proof/metadata";
import { MemoryEvidenceStore, rawCid } from "@/lib/proof/storage";
import { rawSha256Digest } from "@/lib/metadata/ingest";
import { createHash } from "node:crypto";
import { verifyProof } from "@/lib/proof/verify";
import type { ChainProvider } from "@/lib/chain/provider";
const creator = `0x${"a".repeat(40)}` as Address,
  token = `0x${"b".repeat(40)}` as Address,
  registry = `0x${"c".repeat(40)}` as Address;
const txHash = `0x${"1".repeat(64)}` as const,
  blockHash = `0x${"2".repeat(64)}` as const;
const bytes = toBytes(canonicalProofMetadata({ chainId: 46630, creator, token, description: "Creator claim, not an endorsement" }));
const hash = keccak256(bytes),
  uri = `ipfs://${rawCid(bytes)}`;
const receipt = {
  status: "success",
  blockHash,
  blockNumber: 10n,
  logs: [
    {
      address: registry,
      topics: encodeEventTopics({ abi: REGISTRY_ABI, eventName: "ProofSubmitted", args: { creator, token, metadataHash: hash } }),
      data: encodeAbiParameters([{ type: "string" }], [uri]),
    },
  ],
};
const provider = (over = {}) =>
  ({
    chainId: 46630,
    getChainId: async () => 46630,
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 30n,
    getBlock: async () => ({ hash: blockHash }),
    readContract: async () => ({ metadataHash: hash, metadataURI: uri }),
    ...over,
  }) as unknown as ChainProvider;
const input = { chainId: 46630, creator, token, registry, txHash, confirmations: 12n };
describe("independent commitment verification", () => {
  it("reproduces exact bytes without database claims", async () => {
    const r = await verifyProof(input, provider(), async () => bytes);
    expect(r.status).toBe("cryptographically_verified");
    expect(r.metadataHash).toBe(hash);
    expect(r.creatorAuthority).toBe("unverified");
  });
  it("identifies a historical replaced proof", async () => {
    expect(
      (await verifyProof(input, provider({ readContract: async () => ({ metadataHash: `0x${"3".repeat(64)}`, metadataURI: uri }) }), async () => bytes)).status,
    ).toBe("historical_verified");
  });
  it("rejects unavailable, changed, malformed and wrong-creator documents", async () => {
    await expect(
      verifyProof(input, provider(), async () => {
        throw new Error("gateway down");
      }),
    ).rejects.toMatchObject({ code: "content_unavailable" });
    await expect(verifyProof(input, provider(), async () => toBytes("changed"))).rejects.toMatchObject({ code: "hash_mismatch" });
    await expect(verifyProof({ ...input, creator: token }, provider(), async () => bytes)).rejects.toMatchObject({ code: "no_matching_event" });
    expect(() => parseCanonicalProof(toBytes(Buffer.from(bytes).toString().replace("46630", "1")))).not.toThrow();
    expect(() => parseCanonicalProof(toBytes(" " + Buffer.from(bytes).toString()))).toThrow("canonical");
    expect(() => parseCanonicalProof(toBytes('{"schema":"unknown"}'))).toThrow();
  });
  it("rejects wrong networks, pending, unconfirmed and reorged receipts", async () => {
    await expect(verifyProof({ ...input, chainId: 1 }, provider(), async () => bytes)).rejects.toMatchObject({ code: "wrong_network" });
    await expect(verifyProof(input, provider({ getTransactionReceipt: async () => null }), async () => bytes)).rejects.toMatchObject({ code: "pending" });
    await expect(verifyProof(input, provider({ getBlockNumber: async () => 10n }), async () => bytes)).rejects.toMatchObject({ code: "unconfirmed" });
    await expect(verifyProof(input, provider({ getBlock: async () => ({ hash: txHash }) }), async () => bytes)).rejects.toMatchObject({ code: "reorganized" });
  });
  it("uses raw-codec CIDs and retains immutable historical bytes", async () => {
    const store = new MemoryEvidenceStore();
    const original = await store.put(bytes);
    const changed = await store.put(toBytes("different"));
    expect(changed.uri).not.toBe(original.uri);
    expect(store.documents.get(original.uri)).toEqual(bytes);
    expect(rawSha256Digest(original.uri.slice(7))).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

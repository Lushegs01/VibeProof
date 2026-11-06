import { afterEach, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";
import { IpfsEvidenceStore, rawCid, evidenceStorageDisclosure } from "@/lib/proof/storage";
import { canonicalProofMetadata } from "@/lib/proof/metadata";
const bytes = toBytes(
  canonicalProofMetadata({ chainId: 46630, token: `0x${"1".repeat(40)}`, creator: `0x${"2".repeat(40)}`, description: "Independent IPFS transport fixture" }),
);
afterEach(() => vi.unstubAllEnvs());
it("pins exact canonical bytes only to the configured host and checks read-after-write", async () => {
  vi.stubEnv("IPFS_WRITE_API", "https://pinning.example");
  vi.stubEnv("IPFS_WRITE_TOKEN", "configured-test-token");
  const upload = vi.fn<typeof fetch>(async (url, options) => {
    expect(new URL(String(url)).origin).toBe("https://pinning.example");
    expect(options?.redirect).toBe("error");
    expect(options?.headers).toEqual({ authorization: "Bearer configured-test-token" });
    const file = (options?.body as FormData).get("file") as Blob;
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    return Response.json({ Key: rawCid(bytes) });
  });
  const retrieve = vi.fn(async () => bytes);
  const stored = await new IpfsEvidenceStore(upload, retrieve).put(bytes);
  expect(stored).toEqual({ uri: `ipfs://${rawCid(bytes)}`, hash: keccak256(bytes) });
  expect(retrieve).toHaveBeenCalledWith(stored.uri);
});
it("refuses unconfigured providers, wrong CIDs, transport failures and unavailable or changed retrieval", async () => {
  vi.stubEnv("IPFS_WRITE_API", "");
  const upload = vi.fn<typeof fetch>();
  await expect(new IpfsEvidenceStore(upload).put(bytes)).rejects.toThrow("explicitly configured");
  expect(upload).not.toHaveBeenCalled();
  vi.stubEnv("IPFS_WRITE_API", "https://pinning.example");
  await expect(new IpfsEvidenceStore(async () => Response.json({ Key: "wrong" })).put(bytes)).rejects.toThrow("unexpected CID");
  await expect(new IpfsEvidenceStore(async () => new Response("refused", { status: 503 })).put(bytes)).rejects.toThrow("HTTP 503");
  await expect(
    new IpfsEvidenceStore(
      async () => Response.json({ Key: rawCid(bytes) }),
      async () => toBytes("changed"),
    ).put(bytes),
  ).rejects.toThrow("integrity mismatch");
  await expect(
    new IpfsEvidenceStore(
      async () => Response.json({ Key: rawCid(bytes) }),
      async () => {
        throw new Error("gateway unavailable");
      },
    ).put(bytes),
  ).rejects.toThrow("gateway unavailable");
});
it("discloses the public pinning provider without credentials or request paths", () => {
  vi.stubEnv("EVIDENCE_STORAGE", "ipfs");
  vi.stubEnv("IPFS_WRITE_API", "https://pinning.example/operator/path");
  vi.stubEnv("IPFS_WRITE_TOKEN", "private-provider-token");
  const disclosure = evidenceStorageDisclosure();
  expect(disclosure).toContain("pinning.example");
  expect(disclosure).toContain("remain available");
  expect(disclosure).not.toContain("operator/path");
  expect(disclosure).not.toContain("private-provider-token");
});

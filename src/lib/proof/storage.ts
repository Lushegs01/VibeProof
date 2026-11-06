import { localEvidenceUrl, retrieveLocalEvidence } from "./local-evidence";
import { createHash } from "node:crypto";
import { keccak256, type Hash } from "viem";
import { getDb, schema } from "../db/client";
import { parseCanonicalProof } from "./metadata";
import { gatewayUrls, normalizeMetadataUri, rawSha256Digest } from "../metadata/ingest";
import { safeFetch } from "./safe-fetch";
import { validatePublicUrl } from "./url-guard";

export interface EvidenceStore {
  put(bytes: Uint8Array): Promise<{ uri: string; hash: Hash }>;
}
export class MemoryEvidenceStore implements EvidenceStore {
  readonly documents = new Map<string, Uint8Array>();
  async put(bytes: Uint8Array) {
    const hash = keccak256(bytes);
    const uri = `ipfs://${rawCid(bytes)}`;
    this.documents.set(uri, bytes.slice());
    return { uri, hash };
  }
}
/** CIDv1 / raw (0x55) / sha2-256 (0x12) / 32 bytes. Never compare DAG-PB CIDs to a raw digest. */
export function rawCid(bytes: Uint8Array) {
  const cid = Buffer.concat([Buffer.from([1, 0x55, 0x12, 32]), createHash("sha256").update(bytes).digest()]);
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "b";
  for (const byte of cid) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export class DatabaseEvidenceStore implements EvidenceStore {
  async put(bytes: Uint8Array) {
    const db = getDb();
    if (!db) throw new Error("Evidence database unavailable");
    const doc = parseCanonicalProof(bytes);
    const hash = keccak256(bytes);
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
    if (process.env.NODE_ENV === "production" && !validatePublicUrl(origin.href).ok) throw new Error("Configure a public HTTPS NEXT_PUBLIC_APP_URL");
    const uri = new URL(`/api/evidence/${hash}`, origin).href;
    await db
      .insert(schema.proofDocuments)
      .values({ hash, chainId: doc.chainId, tokenAddress: doc.token, creatorAddress: doc.creator, canonical: Buffer.from(bytes).toString("utf8"), uri })
      .onConflictDoNothing();
    return { uri, hash };
  }
}
/** Explicitly configured Kubo block API; exact raw block pinned, no implicit third-party uploads. */
export class IpfsEvidenceStore implements EvidenceStore {
  constructor(
    private readonly transport: typeof fetch = fetch,
    private readonly retrieve: typeof retrieveEvidence = retrieveEvidence,
  ) {}
  async put(bytes: Uint8Array) {
    parseCanonicalProof(bytes);
    const endpoint = process.env.IPFS_WRITE_API;
    if (!endpoint || !validatePublicUrl(endpoint).ok) throw new Error("IPFS_WRITE_API must be an explicitly configured public HTTPS Kubo API");
    const url = new URL("/api/v0/block/put?format=raw&mhtype=sha2-256&pin=true", endpoint);
    const form = new FormData();
    form.set("file", new Blob([Uint8Array.from(bytes)]), "proof.json");
    const response = await this.transport(url, {
      method: "POST",
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: process.env.IPFS_WRITE_TOKEN ? { authorization: `Bearer ${process.env.IPFS_WRITE_TOKEN}` } : {},
    });
    if (!response.ok) throw new Error(`IPFS storage failed (HTTP ${response.status})`);
    const cid = rawCid(bytes);
    const output = (await response.json()) as { Key?: string };
    if (output.Key !== cid) throw new Error("IPFS provider returned an unexpected CID");
    // Verify retrieval before offering this URI to a wallet.
    const retrieved = await this.retrieve(`ipfs://${cid}`);
    if (keccak256(retrieved) !== keccak256(bytes)) throw new Error("IPFS retrieval integrity mismatch");
    return { uri: `ipfs://${cid}`, hash: keccak256(bytes) };
  }
}
export function evidenceStore(): EvidenceStore {
  const backend = process.env.EVIDENCE_STORAGE ?? "database";
  if (backend === "ipfs") return new IpfsEvidenceStore();
  if (backend === "database") return new DatabaseEvidenceStore();
  throw new Error("EVIDENCE_STORAGE must be database or ipfs");
}
export async function retrieveEvidence(uri: string): Promise<Uint8Array> {
  const local = localEvidenceUrl(uri);
  if (local) return retrieveLocalEvidence(local);
  const normalized = normalizeMetadataUri(uri);
  const urls = normalized.kind === "ipfs" ? gatewayUrls(normalized.cid, normalized.path) : normalized.kind === "https" ? [normalized.url] : [];
  if (!urls.length) throw new Error("Unsupported or legacy evidence URI");
  for (const url of urls) {
    try {
      const response = await safeFetch(url, { maxBytes: 16384, allowHttp: false, timeoutMs: 5000 });
      if (response.status !== 200 || response.truncated) continue;
      if (normalized.kind === "ipfs" && !normalized.path) {
        const digest = rawSha256Digest(normalized.cid);
        if (digest && createHash("sha256").update(response.bytes).digest("hex") !== digest) continue;
      }
      return response.bytes;
    } catch {
      /* Try the next configured gateway; no successful claim until bytes verify. */
    }
  }
  throw new Error("Immutable evidence content unavailable or integrity check failed");
}

/** Only this public disclosure is passed to the browser; provider credentials and paths stay server-side. */
export function evidenceStorageDisclosure() {
  const mode = process.env.EVIDENCE_STORAGE ?? "database";
  if (mode === "database") return "Your evidence will be public and stored on this VibeProof deployment.";
  if (mode !== "ipfs" || !process.env.IPFS_WRITE_API || !validatePublicUrl(process.env.IPFS_WRITE_API).ok)
    throw new Error("Configure a supported evidence storage provider before accepting submissions");
  return `Your evidence will be public and pinned to IPFS using ${new URL(process.env.IPFS_WRITE_API).hostname}. Public copies may remain available after an update or deletion request.`;
}

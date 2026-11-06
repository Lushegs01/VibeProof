import { and, eq, sql } from "drizzle-orm";
import { decodeEventLog, getAddress, parseAbiItem, type Address, type Hash } from "viem";
import { getProvider, type ChainProvider } from "../chain/provider";
import { getDb, schema } from "../db/client";
import { ERC20_ABI } from "../vibe/abis";
import { checkGithub, checkWebsite, socialClaim, type UrlCheckResult } from "../proof/checks";
import { canonicalProofMetadata, type ProofSubmission } from "../proof/metadata";
import { invalidatePassport } from "./token-service";
import { evidenceStore } from "../proof/storage";
import { log } from "../util/log";
import { serviceNetwork } from "./network";

const { projectProofs, verificationChecks, launches, feedEvents } = schema;
/**
 * Proof submission, SIWE and the registry live on ONE network: the active one
 * (NEXT_PUBLIC_VIBEPROOF_NETWORK). Proofs are keyed by chain id like everything else.
 */
const chainId = () => serviceNetwork().chainId;

export class ProofError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Who may attach proof to a token:
 *  - the launcher recorded in the vibe/vibe launch event (indexed), or
 *  - the address returned by the token's owner() (for non-Vibe tokens / fallbacks).
 * Returns the basis used, for display.
 */
export async function authorizeSubmitter(
  token: Address,
  submitter: Address,
  provider: ChainProvider = getProvider(serviceNetwork().slug),
): Promise<"launch_creator" | "contract_owner" | null> {
  const db = getDb();
  if (db) {
    const l = await db.query.launches.findFirst({ where: and(eq(launches.chainId, chainId()), eq(launches.tokenAddress, token.toLowerCase())) });
    if (l) return l.creatorAddress === submitter.toLowerCase() ? "launch_creator" : null;
  }
  try {
    const owner = await provider.readContract<Address>({ address: token, abi: ERC20_ABI, functionName: "owner" });
    if (owner && getAddress(owner) === getAddress(submitter)) return "contract_owner";
  } catch {
    /* no owner() */
  }
  return null;
}

export async function runProofChecks(token: Address, p: Partial<ProofSubmission>): Promise<UrlCheckResult[]> {
  const jobs: Promise<UrlCheckResult>[] = [];
  if (p.websiteUrl) jobs.push(checkWebsite("website", p.websiteUrl, token));
  if (p.githubUrl) jobs.push(checkGithub(p.githubUrl, token));
  if (p.demoUrl) jobs.push(checkWebsite("demo", p.demoUrl, token));
  if (p.docsUrl) jobs.push(checkWebsite("docs", p.docsUrl, token));
  if (p.twitterUrl) jobs.push(Promise.resolve(socialClaim("twitter", p.twitterUrl)));
  if (p.discordUrl) jobs.push(Promise.resolve(socialClaim("discord", p.discordUrl)));
  const settled = await Promise.allSettled(jobs);
  const targets = (
    [
      ["website", p.websiteUrl],
      ["github", p.githubUrl],
      ["demo", p.demoUrl],
      ["docs", p.docsUrl],
      ["twitter", p.twitterUrl],
      ["discord", p.discordUrl],
    ] as const
  ).filter(([, url]) => !!url);
  return settled.map((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : {
          type: targets[i][0],
          url: targets[i][1]!,
          state: "unavailable" as const,
          summary: "Check could not complete",
          facts: {},
          evidence: { source: "VibeProof checks", method: "Failed external check", observedAt: new Date().toISOString() },
        },
  );
}

export async function submitProof(submitter: Address, input: ProofSubmission) {
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Proof storage is not configured.");
  const token = getAddress(input.token);
  const basis = await authorizeSubmitter(token, submitter);
  if (!basis) throw new ProofError(403, "not_creator", "Only the launch creator (or the contract's current owner) can submit project proof for this token.");
  const canonical = canonicalProofMetadata({ ...input, chainId: chainId(), creator: submitter });
  const { hash: metadataHash, uri: metadataUri } = await evidenceStore().put(new TextEncoder().encode(canonical));
  const a = token.toLowerCase();
  // Retain the exact historical bytes for every backend, including pinned IPFS submissions.
  await db
    .insert(schema.proofDocuments)
    .values({ hash: metadataHash, chainId: chainId(), tokenAddress: a, creatorAddress: submitter.toLowerCase(), canonical, uri: metadataUri })
    .onConflictDoNothing();
  const values = {
    websiteUrl: input.websiteUrl ?? null,
    githubUrl: input.githubUrl ?? null,
    demoUrl: input.demoUrl ?? null,
    docsUrl: input.docsUrl ?? null,
    twitterUrl: input.twitterUrl ?? null,
    discordUrl: input.discordUrl ?? null,
    description: input.description ?? null,
    submittedBy: submitter.toLowerCase(),
    submitterIsCreator: basis === "launch_creator",
    metadataHash,
    metadataUri,
    updatedAt: new Date(),
  };
  await db
    .insert(projectProofs)
    .values({ chainId: chainId(), tokenAddress: a, ...values })
    .onConflictDoUpdate({ target: [projectProofs.chainId, projectProofs.tokenAddress], set: { ...values, registryTx: null } });
  const checks = await runProofChecks(token, input);
  await storeChecks(a, checks);
  const n = [input.websiteUrl, input.githubUrl, input.demoUrl, input.docsUrl, input.twitterUrl, input.discordUrl].filter(Boolean).length;
  await db
    .insert(feedEvents)
    .values({ chainId: chainId(), tokenAddress: a, kind: "proof", message: `Project proof submitted (${n} link${n === 1 ? "" : "s"})` });
  await invalidatePassport(a);
  log("info", "proof.submitted", { token: a, basis, checks: checks.length });
  return { metadataHash, metadataUri, basis, checks, token, creator: submitter, chainId: chainId() };
}

export async function storeChecks(tokenLower: string, checks: UrlCheckResult[]) {
  const db = getDb();
  if (!db || !checks.length) return;
  await db.insert(verificationChecks).values(
    checks.map((c) => ({
      chainId: chainId(),
      tokenAddress: tokenLower,
      checkType: c.type,
      status: c.state,
      evidence: c,
      observedAt: new Date(c.evidence.observedAt),
    })),
  );
}

export async function recheckProof(token: Address) {
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Proof storage is not configured.");
  const a = token.toLowerCase();
  const proof = await db.query.projectProofs.findFirst({ where: and(eq(projectProofs.chainId, chainId()), eq(projectProofs.tokenAddress, a)) });
  if (!proof) throw new ProofError(404, "no_proof", "No project proof has been submitted for this token.");
  const checks = await runProofChecks(token, {
    websiteUrl: proof.websiteUrl ?? undefined,
    githubUrl: proof.githubUrl ?? undefined,
    demoUrl: proof.demoUrl ?? undefined,
    docsUrl: proof.docsUrl ?? undefined,
    twitterUrl: proof.twitterUrl ?? undefined,
    discordUrl: proof.discordUrl ?? undefined,
  });
  await storeChecks(a, checks);
  await invalidatePassport(a);
  return checks;
}

export const PROOF_SUBMITTED_EVENT = parseAbiItem(
  "event ProofSubmitted(address indexed creator, address indexed token, bytes32 indexed metadataHash, string metadataURI)",
);
export const PROOF_UPDATED_EVENT = parseAbiItem(
  "event ProofUpdated(address indexed creator, address indexed token, bytes32 indexed metadataHash, string metadataURI)",
);

/**
 * Record an onchain anchor ONLY after independently checking the receipt:
 * the tx must have succeeded and contain a ProofSubmitted/ProofUpdated log from the
 * configured registry with matching creator, token and metadata hash.
 */
export async function recordAnchor(token: Address, txHash: Hash, opts?: { retrieve?: typeof import("../proof/storage").retrieveEvidence }) {
  const registry = serviceNetwork().slug === "robinhood-mainnet" ? process.env.ROBINHOOD_MAINNET_REGISTRY_ADDRESS : process.env.NEXT_PUBLIC_REGISTRY_ADDRESS;
  if (!registry) throw new ProofError(503, "registry_unconfigured", "No VibeProofRegistry address is configured.");
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Proof storage is not configured.");
  const a = token.toLowerCase();
  const proof = await db.query.projectProofs.findFirst({ where: and(eq(projectProofs.chainId, chainId()), eq(projectProofs.tokenAddress, a)) });
  if (!proof?.metadataHash) throw new ProofError(404, "no_proof", "Submit project proof before anchoring it.");
  const receipt = await getProvider(serviceNetwork().slug).getTransactionReceipt(txHash);
  if (!receipt) throw new ProofError(404, "tx_not_found", "Transaction not found (yet).");
  if (receipt.status !== "success") throw new ProofError(400, "tx_failed", "Transaction reverted.");
  const match = receipt.logs.some((l) => {
    if (l.address.toLowerCase() !== registry.toLowerCase()) return false;
    try {
      const ev = decodeEventLog({ abi: [PROOF_SUBMITTED_EVENT, PROOF_UPDATED_EVENT], data: l.data, topics: l.topics as never });
      return (
        ev.args.creator.toLowerCase() === proof.submittedBy &&
        ev.args.token.toLowerCase() === a &&
        ev.args.metadataHash === proof.metadataHash &&
        (!proof.metadataUri || ev.args.metadataURI === proof.metadataUri)
      );
    } catch {
      return false;
    }
  });
  if (!match) throw new ProofError(400, "no_matching_event", "Transaction does not contain a matching registry event for this proof.");
  if (proof.metadataUri) {
    const { verifyProof } = await import("../proof/verify");
    const required = Number(process.env.PROOF_CONFIRMATIONS ?? 12);
    if (!Number.isSafeInteger(required) || required < 1) throw new ProofError(503, "invalid_finality", "Invalid proof confirmation policy.");
    try {
      await verifyProof(
        { txHash, registry: getAddress(registry), token, creator: getAddress(proof.submittedBy), chainId: chainId(), confirmations: BigInt(required) },
        getProvider(serviceNetwork().slug),
        opts?.retrieve,
      );
    } catch (e) {
      const { ProofVerificationError } = await import("../proof/verify");
      if (e instanceof ProofVerificationError) throw new ProofError(409, e.code, e.message);
      throw e;
    }
  }
  const updated = await db
    .update(projectProofs)
    .set({ registryTx: txHash, updatedAt: new Date() })
    .where(and(eq(projectProofs.chainId, chainId()), eq(projectProofs.tokenAddress, a), eq(projectProofs.metadataHash, proof.metadataHash)))
    .returning();
  if (!updated.length) throw new ProofError(409, "proof_changed", "Proof changed while verifying; retry the current commitment.");
  await invalidatePassport(a);
  return { registryTx: txHash };
}

/** Re-run checks for proofs whose latest check is older than `maxAgeHours`. Called by the indexer loop. */
export async function recheckStaleProofs(limit = 5, maxAgeHours = 6, onFailure?: (error: unknown) => void) {
  const db = getDb();
  if (!db) return 0;
  const rows = await db.execute<{ token_address: string }>(sql`
    select p.token_address from project_proofs p
    left join lateral (select max(observed_at) as last from verification_checks c where c.chain_id = p.chain_id and c.token_address = p.token_address) c on true
    where p.chain_id = ${chainId()} and (c.last is null or c.last < now() - make_interval(hours => ${maxAgeHours}))
    order by c.last nulls first limit ${limit}`);
  let n = 0;
  for (const r of rows) {
    try {
      await recheckProof(getAddress(r.token_address));
      n++;
    } catch (e) {
      onFailure?.(e);
      log("warn", "proof.recheck_failed", { token: r.token_address, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return n;
}

import type { ContractAnalysis } from "../analysis/contract";
import type { UrlCheckResult } from "../proof/checks";
import type { Evidence, Observed, VerificationState } from "../verification/types";
import type { ActivityDiff } from "../changes/diff";
import type { MetadataClaims } from "../metadata/ingest";

export type LaunchInfo = {
  launchpad: string;
  deploymentId: string;
  version: string | null;
  eventName: string | null;
  factory: string;
  launchId: string | null;
  curve: string | null;
  /** Quote currency of the curve; 0x000…0 = native ETH; null = unknown. */
  pairCurrency: string | null;
  txHash: string;
  blockNumber: string;
  createdAt: string;
  /** false when created_at was interpolated between block headers. */
  createdAtExact: boolean | null;
  /** "bonding" | "curve_completed" | "graduated" | "unknown" (only from observed curve events). */
  status: string;
  graduatedAt: string | null;
  graduatedTx: string | null;
  curveCompletedAt: string | null;
};

/**
 * How much of a token's onchain history VibeProof holds.
 *  - fully_covered: every Transfer/curve event from the launch block to `indexedThrough`
 *  - indexing:      a worker is processing its history right now
 *  - partial:       launch known; history incomplete and queued
 *  - error:         the history backfill failed (retrying, or dead-lettered)
 *  - not_indexed:   no history and nothing queued (e.g. not a launch from a configured launchpad)
 */
export type CoverageStatus = "not_indexed" | "indexing" | "partial" | "fully_covered" | "error";

export type CoverageInfo = {
  status: CoverageStatus;
  explanation: string;
  indexedThrough: string | null;
  launchBlock: string | null;
  backfill: {
    status: string;
    reason: string | null;
    attempts: number;
    lastError: string | null;
    nextAttemptAt: string | null;
    requestedAt: string;
    /** Jobs ahead of this one (null when not waiting). */
    position: number | null;
  } | null;
};

export type MetadataSection = {
  uri: string;
  status: string;
  gateway: string | null;
  normalizedUrl: string | null;
  fetchedAt: string | null;
  /** Bytes hash to the CID in the URI (null = CID kind not checkable). */
  cidVerified: boolean | null;
  onchainDigest: string | null;
  /** keccak256(bytes) equals the launch event's metadataDigest (null = no onchain digest). */
  digestMatch: boolean | null;
  keccak256: string | null;
  error: string | null;
  /** Everything in here is a CREATOR CLAIM. */
  claims: MetadataClaims | null;
  /** Independent checks of links claimed in the metadata. */
  checks: UrlCheckResult[];
  evidence: Evidence;
};

/** Same metric from two sources, side by side, with why they can legitimately differ. */
export type Reconciliation = {
  metric: "holders" | "transfers";
  indexer: number | null;
  explorer: number | null;
  explanation: string;
  evidence: { indexer: Evidence; explorer: Evidence };
}[];

export type CreatorSummary = {
  address: string;
  firstSeenAt: string | null;
  launchCount: number;
  graduatedLaunchCount: number;
  activeLaunchCount: number;
  historicalLaunchCount: number;
  evidence: Evidence;
};

export type ActivityMetrics = {
  holders: Observed<number>;
  transactions: Observed<number>;
  buys: Observed<number>;
  sells: Observed<number>;
  buyers: Observed<number>;
  sellers: Observed<number>;
  volumeEth: Observed<string>;
  lastActivityAt: Observed<string>;
};

export type ProofSection = {
  submitted: boolean;
  submittedBy: string | null;
  submitterIsCreator: boolean;
  submittedAt: string | null;
  description: string | null;
  metadataHash: string | null;
  registryTx: string | null;
  checks: UrlCheckResult[];
  /** e.g. { observed: 2, total: 3 } over website/github/demo */
  score: { observed: number; total: number };
};

export type RecentEvent = {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  timestamp: string;
  type: string;
  wallet: string | null;
  amount: string | null;
  quoteAmount: string | null;
};

export type TokenPassport = {
  chain: string;
  chainName: string;
  chainId: number;
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  isVibeLaunch: boolean;
  createdAt: string | null;
  metadataUri: string | null;
  launch: LaunchInfo | null;
  contract: ContractAnalysis;
  creator: CreatorSummary | null;
  activity: ActivityMetrics;
  proof: ProofSection;
  recent: RecentEvent[];
  topHolders: { wallet: string; balance: string; pct: number | null; label?: string | null }[] | null;
  indexer: { indexedThrough: string | null; covered: boolean; queued?: boolean };
  coverage: CoverageInfo;
  metadata: MetadataSection | null;
  reconciliation: Reconciliation | null;
  observedAt: string;
  demo: boolean;
};

export type ChangesResponse = {
  since: string;
  baselineAt: string | null;
  baselineExact: boolean;
  diffs: ActivityDiff[];
  events: { kind: string; message: string; at: string; txHash: string | null }[];
};

export type ProductState = VerificationState;

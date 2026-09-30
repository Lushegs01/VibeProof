import type { ContractAnalysis } from "../analysis/contract";
import type { UrlCheckResult } from "../proof/checks";
import type { Evidence, Observed, VerificationState } from "../verification/types";
import type { ActivityDiff } from "../changes/diff";

export type LaunchInfo = {
  deploymentId: string;
  factory: string;
  launchId: string | null;
  curve: string | null;
  pairCurrency: string | null;
  txHash: string;
  blockNumber: string;
  createdAt: string;
  status: string;
  graduatedAt: string | null;
};

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

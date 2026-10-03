import type { AbiEvent, Address, Hash, Log } from "viem";

/**
 * Launchpad abstraction. The indexer core, database and services depend only on these
 * types, never on a specific factory address, so another launchpad (or a new Vibe
 * version) is added by writing/configuring an adapter, not by editing the indexer.
 */

/** How a deployment's configuration was established. Never claim more than the evidence supports. */
export type DeploymentSource =
  /** Published by the launchpad team in official documentation. */
  | "official_documentation"
  /** Read from the launchpad's publicly served app configuration AND confirmed onchain (bytecode + emitted events). */
  | "public_app_config+onchain"
  /** Found only by onchain observation (e.g. matching event topics); not endorsed by any launchpad source. */
  | "onchain_only"
  /** Operator-supplied (env) or otherwise unverified. */
  | "unknown";

export type DeploymentProvenance = {
  source: DeploymentSource;
  /** Where the values came from (URLs, config keys, tx hashes). */
  references: string[];
  /** When the configuration was last checked against its sources (ISO date). */
  verifiedAt: string | null;
  /** Factory creation transaction and block, when known. */
  creationTx?: Hash;
  creationBlock?: bigint;
  /** Source verified on the block explorer? null = unknown. */
  sourceVerified: boolean | null;
  notes?: string;
};

export type LaunchpadDeployment = {
  /** Stable id, unique per chain, used in cursors and stored on launches (e.g. "v6-run15"). */
  id: string;
  launchpad: string;
  chainId: number;
  /** Contract generation; selects event definitions (e.g. "v5", "v6"). */
  version: string;
  factory: Address;
  /** First block to scan for launches. null = unknown (indexing starts at the current head). */
  startBlock: bigint | null;
  /** Labelled protocol contracts. Used to label holders and exclude them from holder counts, nothing else. */
  protocolContracts: Record<string, Address>;
  provenance: DeploymentProvenance;
  enabled: boolean;
};

export type DecodedLaunch = {
  launchpad: string;
  deploymentId: string;
  version: string;
  /** Name of the event that announced the launch (e.g. "LaunchCreated"). */
  eventName: string;
  factory: Address;
  launchId: bigint;
  token: Address;
  creator: Address;
  curve: Address | null;
  /** Quote currency of the curve. ZERO_ADDRESS = native ETH. null = unknown. */
  pairCurrency: Address | null;
  name: string | null;
  symbol: string | null;
  decimals?: number | null;
  totalSupply?: bigint | null;
  metadataURI: string | null;
  /** Onchain commitment to the metadata bytes, when the event carries one (v5: keccak256). */
  metadataDigest: `0x${string}` | null;
  txHash: Hash;
  blockNumber: bigint;
  blockHash: Hash | null;
  logIndex: number;
  timestamp: Date | null;
  /** true when the timestamp came from the block header, false when interpolated. */
  timestampExact?: boolean;
  raw: Record<string, unknown>;
};

export type DecodedTrade = {
  kind: "buy" | "sell";
  curve: Address;
  trader: Address;
  tokenAmount: bigint;
  /** Amount of the curve's pair currency. */
  quoteAmount: bigint;
  eventName: string;
  txHash: Hash;
  blockNumber: bigint;
  blockHash: Hash | null;
  logIndex: number;
  timestamp: Date | null;
  timestampExact?: boolean;
};

export type DecodedGraduation = {
  /** "graduated" = liquidity migrated to a pool; "curve_completed" = curve reached its target (not yet migrated). */
  kind: "graduated" | "curve_completed";
  curve: Address;
  eventName: string;
  poolId: `0x${string}` | null;
  tokenAmount: bigint | null;
  quoteAmount: bigint | null;
  txHash: Hash;
  blockNumber: bigint;
  blockHash: Hash | null;
  logIndex: number;
  timestamp: Date | null;
  timestampExact?: boolean;
};

export interface LaunchpadAdapter {
  readonly id: string;
  readonly label: string;
  readonly chainId: number;
  /** Enabled, configured deployments for this chain. */
  deployments(): LaunchpadDeployment[];
  isFactory(address: string): LaunchpadDeployment | null;
  getLaunchEvents(dep: LaunchpadDeployment): readonly AbiEvent[];
  decodeLaunch(log: Log, dep: LaunchpadDeployment): DecodedLaunch | null;
  /** Every event a curve may emit that the adapter can decode (trades + graduations). */
  getCurveEvents(): readonly AbiEvent[];
  decodeTrade(log: Log): DecodedTrade | null;
  decodeGraduation(log: Log): DecodedGraduation | null;
  /** Chain/deployment-configured protocol addresses excluded from holder counts. */
  protocolExclusions(): { address: string; label: string }[];
}

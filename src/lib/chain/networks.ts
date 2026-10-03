import { defineChain, type Chain } from "viem";

/**
 * Static, public network facts. Safe to import from client components: nothing in this
 * file reads secrets. Server-only settings (provider URLs that may embed API keys) live in
 * ./chains.ts.
 *
 * Verified 2026-10-03 against https://docs.robinhood.com/chain/connecting and live
 * eth_chainId calls (mainnet 0x1237 = 4663, testnet 0xb626 = 46630). See docs/assessment.md.
 */
export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export type NetworkSlug = "robinhood-mainnet" | "robinhood-testnet";

/**
 * eth_getLogs limits observed on the PUBLIC endpoints (docs/assessment.md §9). They are
 * starting points only: the provider adapts to whatever limit an error message reports,
 * so a provider with different limits (e.g. Alchemy) works without configuration.
 */
export type LogLimits = {
  /** Max block span for a topic-only query (no address filter). */
  topicOnlySpan: bigint;
  /** Max block span when several addresses/topics are OR-ed. */
  multiValueSpan: bigint;
  /** Max block span for a single-address query. */
  singleAddressSpan: bigint;
  /** Max combined address + topic selectors per query. */
  maxSelectors: number;
};

export type NetworkInfo = {
  slug: NetworkSlug;
  chain: Chain;
  chainId: number;
  name: string;
  shortName: string;
  testnet: boolean;
  explorerUrl: string;
  publicRpcUrl: string;
  /** Average block time measured over 100k blocks on 2026-10-03; human-facing estimates only. */
  approxBlockTimeMs: number;
  logLimits: LogLimits;
};

export const NETWORKS: Record<NetworkSlug, NetworkInfo> = {
  "robinhood-mainnet": {
    slug: "robinhood-mainnet",
    chain: robinhoodMainnet,
    chainId: 4663,
    name: "Robinhood Chain",
    shortName: "Mainnet",
    testnet: false,
    explorerUrl: "https://robinhoodchain.blockscout.com",
    publicRpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    approxBlockTimeMs: 102,
    // "query spans N blocks …, but only 30000 are allowed" (topic-only) / 100000 (multi-value)
    logLimits: { topicOnlySpan: 25_000n, multiValueSpan: 90_000n, singleAddressSpan: 2_000_000n, maxSelectors: 500 },
  },
  "robinhood-testnet": {
    slug: "robinhood-testnet",
    chain: robinhoodTestnet,
    chainId: 46630,
    name: "Robinhood Chain Testnet",
    shortName: "Testnet",
    testnet: true,
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
    publicRpcUrl: "https://rpc.testnet.chain.robinhood.com",
    approxBlockTimeMs: 140,
    // "1001 address and topic selectors specified in query, but only 1000 are allowed"
    logLimits: { topicOnlySpan: 5_000n, multiValueSpan: 2_000_000n, singleAddressSpan: 2_000_000n, maxSelectors: 500 },
  },
};

export const SUPPORTED_NETWORKS = Object.keys(NETWORKS) as NetworkSlug[];

export function isNetworkSlug(s: unknown): s is NetworkSlug {
  return typeof s === "string" && s in NETWORKS;
}

export function getNetwork(slug: string | null | undefined): NetworkInfo | null {
  return isNetworkSlug(slug) ? NETWORKS[slug] : null;
}

export function getNetworkByChainId(chainId: number): NetworkInfo | null {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId) ?? null;
}

/**
 * The network the web app serves by default (token routes may still name either network).
 * NEXT_PUBLIC_ so client components agree with the server. Defaults to testnet because that
 * is the only network with a verified vibe/vibe deployment (docs/assessment.md §7).
 */
export function activeNetworkSlug(): NetworkSlug {
  const v = process.env.NEXT_PUBLIC_VIBEPROOF_NETWORK;
  return isNetworkSlug(v) ? v : "robinhood-testnet";
}

export function activeNetwork(): NetworkInfo {
  return NETWORKS[activeNetworkSlug()];
}

export function explorerLink(kind: "address" | "tx" | "block" | "token", value: string | number | bigint, slug: NetworkSlug = activeNetworkSlug()) {
  return `${NETWORKS[slug].explorerUrl}/${kind}/${value.toString()}`;
}

export function tokenPath(address: string, slug: NetworkSlug = activeNetworkSlug()) {
  return `/token/${slug}/${address}`;
}

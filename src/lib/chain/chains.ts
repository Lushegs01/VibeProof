import { NETWORKS, activeNetworkSlug, isNetworkSlug, robinhoodMainnet, robinhoodTestnet, type NetworkInfo, type NetworkSlug } from "./networks";

/**
 * SERVER-ONLY network configuration. Provider URLs may embed API keys (e.g. Alchemy's
 * `/v2/{key}`), so they are read from non-public env vars here and never shipped to the client.
 *
 * Each network has its own variables; mainnet and testnet never share mutable settings.
 *
 *   ROBINHOOD_MAINNET_RPC_URL / ROBINHOOD_MAINNET_WSS_URL / BLOCKSCOUT_MAINNET_API_URL
 *   ROBINHOOD_TESTNET_RPC_URL / ROBINHOOD_TESTNET_WSS_URL / BLOCKSCOUT_TESTNET_API_URL
 *
 * `BLOCKSCOUT_API_URL` (the old single-network name) is honoured for testnet only.
 */
export { robinhoodMainnet, robinhoodTestnet, explorerLink, NETWORKS, activeNetworkSlug } from "./networks";
export type { NetworkSlug } from "./networks";

/** @deprecated use NetworkSlug */
export type ChainSlug = NetworkSlug;

export type ChainConfig = NetworkInfo & {
  rpcUrl: string;
  /** true when no provider URL is configured and the rate-limited public endpoint is used. */
  usingPublicRpc: boolean;
  wssUrl?: string;
  explorerApiUrl: string;
};

const ENV: Record<NetworkSlug, { rpc: string; wss: string; blockscout: string[]; blockscoutDefault: string }> = {
  "robinhood-mainnet": {
    rpc: "ROBINHOOD_MAINNET_RPC_URL",
    wss: "ROBINHOOD_MAINNET_WSS_URL",
    blockscout: ["BLOCKSCOUT_MAINNET_API_URL"],
    blockscoutDefault: "https://robinhoodchain.blockscout.com/api",
  },
  "robinhood-testnet": {
    rpc: "ROBINHOOD_TESTNET_RPC_URL",
    wss: "ROBINHOOD_TESTNET_WSS_URL",
    blockscout: ["BLOCKSCOUT_TESTNET_API_URL", "BLOCKSCOUT_API_URL"],
    blockscoutDefault: "https://explorer.testnet.chain.robinhood.com/api",
  },
};

const env = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

export function getChainConfig(slug: string = activeNetworkSlug()): ChainConfig | null {
  if (!isNetworkSlug(slug)) return null;
  const n = NETWORKS[slug];
  const e = ENV[slug];
  const rpc = env(e.rpc);
  return {
    ...n,
    rpcUrl: rpc ?? n.publicRpcUrl,
    usingPublicRpc: !rpc || rpc.replace(/\/$/, "") === n.publicRpcUrl,
    wssUrl: env(e.wss),
    explorerApiUrl: e.blockscout.map(env).find(Boolean) ?? e.blockscoutDefault,
  };
}

export function getChainConfigById(chainId: number): ChainConfig | null {
  const n = Object.values(NETWORKS).find((x) => x.chainId === chainId);
  return n ? getChainConfig(n.slug) : null;
}

/**
 * Networks the indexer processes. `INDEXER_NETWORKS=robinhood-testnet,robinhood-mainnet`;
 * defaults to the active network. Unknown names are rejected loudly rather than ignored.
 */
export function indexerNetworks(): NetworkSlug[] {
  const raw = env("INDEXER_NETWORKS");
  if (!raw) return [activeNetworkSlug()];
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((s) => !isNetworkSlug(s));
  if (bad.length) throw new Error(`INDEXER_NETWORKS contains unknown network(s): ${bad.join(", ")}. Supported: ${Object.keys(NETWORKS).join(", ")}`);
  return [...new Set(list)] as NetworkSlug[];
}

export const SUPPORTED_CHAINS = Object.keys(NETWORKS) as NetworkSlug[];
export const DEFAULT_CHAIN: NetworkSlug = "robinhood-testnet";

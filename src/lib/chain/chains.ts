import { defineChain } from "viem";

/**
 * Verified network information (see README → "Verified Network Information").
 * Checked 2026-09-30: eth_chainId on the public RPC returned 0xb626 (46630).
 */
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export type ChainSlug = "robinhood-testnet";

export type ChainConfig = {
  slug: ChainSlug;
  chain: typeof robinhoodTestnet;
  rpcUrl: string;
  wssUrl?: string;
  explorerUrl: string;
  explorerApiUrl: string;
};

export function getChainConfig(slug: string = "robinhood-testnet"): ChainConfig | null {
  if (slug !== "robinhood-testnet") return null;
  return {
    slug: "robinhood-testnet",
    chain: robinhoodTestnet,
    rpcUrl: process.env.ROBINHOOD_TESTNET_RPC_URL || robinhoodTestnet.rpcUrls.default.http[0],
    wssUrl: process.env.ROBINHOOD_TESTNET_WSS_URL || undefined,
    explorerUrl: robinhoodTestnet.blockExplorers.default.url,
    explorerApiUrl: process.env.BLOCKSCOUT_API_URL || "https://explorer.testnet.chain.robinhood.com/api",
  };
}

export const SUPPORTED_CHAINS: ChainSlug[] = ["robinhood-testnet"];
export const DEFAULT_CHAIN: ChainSlug = "robinhood-testnet";

export function explorerLink(kind: "address" | "tx" | "block" | "token", value: string | number | bigint) {
  const base = robinhoodTestnet.blockExplorers.default.url;
  return `${base}/${kind}/${value.toString()}`;
}

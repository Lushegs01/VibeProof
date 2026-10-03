import { afterEach, describe, expect, it } from "vitest";
import { NETWORKS, activeNetworkSlug, explorerLink, getNetwork, getNetworkByChainId, tokenPath } from "@/lib/chain/networks";
import { getChainConfig, indexerNetworks } from "@/lib/chain/chains";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("network configuration (verified 2026-10-03 against docs.robinhood.com and eth_chainId)", () => {
  it("knows Robinhood Chain mainnet and testnet with the documented parameters", () => {
    expect(NETWORKS["robinhood-mainnet"]).toMatchObject({ chainId: 4663, explorerUrl: "https://robinhoodchain.blockscout.com", publicRpcUrl: "https://rpc.mainnet.chain.robinhood.com", testnet: false });
    expect(NETWORKS["robinhood-testnet"]).toMatchObject({ chainId: 46630, explorerUrl: "https://explorer.testnet.chain.robinhood.com", publicRpcUrl: "https://rpc.testnet.chain.robinhood.com", testnet: true });
    expect(NETWORKS["robinhood-mainnet"].chain.nativeCurrency.symbol).toBe("ETH");
    expect(NETWORKS["robinhood-testnet"].chain.nativeCurrency.symbol).toBe("ETH");
  });

  it("resolves by slug and chain id, rejecting unknown networks", () => {
    expect(getNetwork("robinhood-mainnet")?.chainId).toBe(4663);
    expect(getNetwork("ethereum")).toBeNull();
    expect(getNetwork(null)).toBeNull();
    expect(getNetworkByChainId(46630)?.slug).toBe("robinhood-testnet");
    expect(getNetworkByChainId(1)).toBeNull();
    expect(getChainConfig("nope")).toBeNull();
  });

  it("defaults the active network to testnet and honours NEXT_PUBLIC_VIBEPROOF_NETWORK", () => {
    delete process.env.NEXT_PUBLIC_VIBEPROOF_NETWORK;
    expect(activeNetworkSlug()).toBe("robinhood-testnet");
    process.env.NEXT_PUBLIC_VIBEPROOF_NETWORK = "robinhood-mainnet";
    expect(activeNetworkSlug()).toBe("robinhood-mainnet");
    process.env.NEXT_PUBLIC_VIBEPROOF_NETWORK = "bogus";
    expect(activeNetworkSlug()).toBe("robinhood-testnet");
  });

  it("never lets one network's provider settings leak into the other", () => {
    process.env.ROBINHOOD_MAINNET_RPC_URL = "https://mainnet.example/v2/KEY";
    process.env.ROBINHOOD_TESTNET_RPC_URL = "";
    process.env.BLOCKSCOUT_MAINNET_API_URL = "https://mainnet-explorer.example/api";
    delete process.env.BLOCKSCOUT_TESTNET_API_URL;
    delete process.env.BLOCKSCOUT_API_URL;
    const main = getChainConfig("robinhood-mainnet")!;
    const test = getChainConfig("robinhood-testnet")!;
    expect(main.rpcUrl).toBe("https://mainnet.example/v2/KEY");
    expect(main.usingPublicRpc).toBe(false);
    expect(test.rpcUrl).toBe("https://rpc.testnet.chain.robinhood.com");
    expect(test.usingPublicRpc).toBe(true);
    expect(main.explorerApiUrl).toBe("https://mainnet-explorer.example/api");
    expect(test.explorerApiUrl).toBe("https://explorer.testnet.chain.robinhood.com/api");
    // The legacy single-network variable only ever applies to testnet.
    process.env.BLOCKSCOUT_API_URL = "https://legacy.example/api";
    expect(getChainConfig("robinhood-testnet")!.explorerApiUrl).toBe("https://legacy.example/api");
    expect(getChainConfig("robinhood-mainnet")!.explorerApiUrl).toBe("https://mainnet-explorer.example/api");
  });

  it("parses INDEXER_NETWORKS and refuses unknown entries", () => {
    delete process.env.INDEXER_NETWORKS;
    delete process.env.NEXT_PUBLIC_VIBEPROOF_NETWORK;
    expect(indexerNetworks()).toEqual(["robinhood-testnet"]);
    process.env.INDEXER_NETWORKS = "robinhood-testnet, robinhood-mainnet,robinhood-testnet";
    expect(indexerNetworks()).toEqual(["robinhood-testnet", "robinhood-mainnet"]);
    process.env.INDEXER_NETWORKS = "robinhood-testnet,goerli";
    expect(() => indexerNetworks()).toThrow(/goerli/);
  });

  it("builds explorer links and token paths per network", () => {
    expect(explorerLink("tx", "0xab", "robinhood-mainnet")).toBe("https://robinhoodchain.blockscout.com/tx/0xab");
    expect(explorerLink("address", "0xcd", "robinhood-testnet")).toBe("https://explorer.testnet.chain.robinhood.com/address/0xcd");
    expect(tokenPath("0x01", "robinhood-mainnet")).toBe("/token/robinhood-mainnet/0x01");
  });
});

import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/logs.json";

/** Live Robinhood Chain Testnet reads. Set SKIP_NETWORK_TESTS=1 to skip offline. */
describe.skipIf(process.env.SKIP_NETWORK_TESTS === "1")("Robinhood Chain Testnet (live)", () => {
  it("public RPC reports chain id 46630", async () => {
    const r = await fetch(process.env.ROBINHOOD_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    expect((await r.json()).result).toBe("0xb626");
  });

  it("configured vibe/vibe factories have bytecode", async () => {
    const { getProvider } = await import("@/lib/chain/provider");
    const { VIBE_DEPLOYMENTS } = await import("@/lib/vibe/contracts");
    for (const d of VIBE_DEPLOYMENTS) {
      const code = await getProvider().getBytecode(d.factory);
      expect(code && code.length > 2).toBe(true);
    }
  });

  it("v6 factory emits LaunchCreated with the topic we decode", async () => {
    const { getProvider } = await import("@/lib/chain/provider");
    const { VIBE_EVENTS } = await import("@/lib/vibe/abis");
    const bn = BigInt(fixtures.launchCreated.blockNumber);
    const logs = await getProvider().getLogs({ address: fixtures.launchCreated.address as `0x${string}`, event: VIBE_EVENTS.LaunchCreated, fromBlock: bn, toBlock: bn });
    expect(logs.length).toBeGreaterThan(0);
  });

  it("analyzes a real vibe/vibe token end-to-end", async () => {
    const { getProvider } = await import("@/lib/chain/provider");
    const { decodeLaunch } = await import("@/indexer/decode");
    const { VIBE_DEPLOYMENTS } = await import("@/lib/vibe/contracts");
    const { analyzeContract } = await import("@/lib/analysis/contract");
    const d = decodeLaunch({ ...fixtures.launchCreated, blockNumber: BigInt(fixtures.launchCreated.blockNumber) } as never, VIBE_DEPLOYMENTS[0])!;
    const a = await analyzeContract(getProvider(), d.token);
    expect(a.basics.exists).toBe(true);
    expect(a.basics.symbol).toBe(d.symbol);
    expect(a.basics.decimals).toBe(18);
    expect(a.checks.every((c) => c.evidence.source && c.evidence.method && c.evidence.observedAt)).toBe(true);
    expect(["verified", "not_found", "unavailable"]).toContain(a.checks.find((c) => c.id === "source_verified")!.state);
  });

  it("reports a non-contract address as missing bytecode", async () => {
    const { getProvider } = await import("@/lib/chain/provider");
    const { analyzeContract } = await import("@/lib/analysis/contract");
    const a = await analyzeContract(getProvider(), "0x000000000000000000000000000000000000dEaD");
    expect(a.basics.exists).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Log } from "viem";
import live from "../fixtures/live-logs-2026-10-03.json";
import legacy from "../fixtures/logs.json";
import { VibeAdapter } from "@/lib/launchpads/vibe";
import { VIBE_EVENTS } from "@/lib/vibe/abis";
import { vibeDeployments, parseExtraDeployments, protocolHolderExclusions } from "@/lib/vibe/contracts";
import { launchpadAdapters } from "@/lib/launchpads/registry";

/** Real logs captured from Robinhood Chain Testnet (see fixture `source`/`observedAt`). */
const asLog = (l: Record<string, unknown>) => ({ ...l, blockNumber: BigInt(l.blockNumber as string), logIndex: Number(BigInt(l.logIndex as string)) }) as unknown as Log;
const legacyLog = (l: Record<string, unknown>) => ({ ...l, blockNumber: BigInt(l.blockNumber as string) }) as unknown as Log;

const adapter = new VibeAdapter(46630);
const [v6, v5] = vibeDeployments(46630);

describe("VibeAdapter: deployments and provenance", () => {
  it("has the two verified testnet deployments with provenance", () => {
    expect(v6).toMatchObject({ id: "v6-run15", version: "v6", factory: "0xe794217880011f9cA6961340eD5c16EC9559Fea0" });
    expect(v5).toMatchObject({ id: "v5-live", version: "v5", factory: "0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59" });
    for (const d of [v5, v6]) {
      expect(d.provenance.source).toBe("public_app_config+onchain");
      expect(d.provenance.creationTx).toMatch(/^0x[0-9a-f]{64}$/);
      expect(d.provenance.sourceVerified).toBe(false);
    }
  });
  it("has NO mainnet deployment (none is known; nothing is guessed)", () => {
    expect(vibeDeployments(4663)).toEqual([]);
    expect(new VibeAdapter(4663).deployments()).toEqual([]);
    expect(launchpadAdapters(4663)[0].deployments()).toEqual([]);
  });
  it("accepts operator-supplied deployments as UNVERIFIED and keeps chains apart", () => {
    const extra = parseExtraDeployments(JSON.stringify([{ chainId: 4663, id: "v6-runx", version: "v6", factory: "0x00000000000000000000000000000000000000f1", startBlock: "100" }]));
    expect(extra[0]).toMatchObject({ chainId: 4663, startBlock: 100n });
    expect(extra[0].provenance.source).toBe("unknown");
    expect(() => parseExtraDeployments(JSON.stringify([{ chainId: 4663, id: "x", version: "v9", factory: "0x1" }]))).toThrow(/VIBE_EXTRA_DEPLOYMENTS/);
  });
  it("excludes protocol contracts per chain, including pairPolicy/giftLists from the current bundle", () => {
    const ex = protocolHolderExclusions(46630).map((x) => x.address);
    expect(ex).toContain("0x48cfa6c8f3591c6f385652cadf71f310afb2cc84"); // pairPolicy
    expect(ex).toContain("0xb78f181aabcc62595a1682714894766001d488be"); // giftLists
    expect(ex).toContain("0x8366a39cc670b4001a1121b8f6a443a643e40951"); // PoolManager
    expect(ex).toContain(v6.factory.toLowerCase());
    expect(protocolHolderExclusions(4663)).toEqual([]);
  });
  it("identifies factories", () => {
    expect(adapter.isFactory(v6.factory.toLowerCase())?.id).toBe("v6-run15");
    expect(adapter.isFactory("0x0000000000000000000000000000000000000001")).toBeNull();
  });
});

describe("VibeAdapter: launch decoding (real logs)", () => {
  it("decodes v6 LaunchCreated", () => {
    const d = adapter.decodeLaunch(legacyLog(legacy.launchCreated), v6)!;
    expect(d).toMatchObject({ deploymentId: "v6-run15", eventName: "LaunchCreated", launchpad: "vibe", version: "v6" });
    expect(d.symbol).toBe("SODA");
    expect(d.pairCurrency).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(d.metadataDigest).toBeNull();
  });
  it("decodes v5 TokenLaunched (ETH curve, metadata digest committed)", () => {
    const d = adapter.decodeLaunch(asLog(live.tokenLaunchedRecent), v5)!;
    expect(d).toMatchObject({ eventName: "TokenLaunched", token: "0xcD256f79e75Cb17d954951Fe35959b60c57bbD20", curve: "0xAFc5df37263D2ce13E29fc7F2e711223dD4C9A19", creator: "0x2563E65717b65fE201e67cBeD2bd42808DA31F0F" });
    expect(d.pairCurrency).toBe("0x0000000000000000000000000000000000000000");
    expect(d.metadataDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(d.symbol).toBeNull(); // v5 events carry no symbol: read from the token
  });
  it("decodes v5 TokenLaunchedQuoted (previously unindexed) with its quote currency", () => {
    const d = adapter.decodeLaunch(asLog(live.tokenLaunchedQuoted), v5)!;
    expect(d.eventName).toBe("TokenLaunchedQuoted");
    expect(d.launchId).toBe(2423n);
    expect(d.token).toBe("0x30Bfa8D160B815c81A45b8beC2CC0DCf8b27b8e3");
    expect(d.pairCurrency).toBe("0x5a5398155d98374C0e26265eA3cb9818169C2739");
  });
  it("rejects a launch log under the wrong deployment, from the wrong address, removed or pending", () => {
    expect(adapter.decodeLaunch(legacyLog(legacy.launchCreated), v5)).toBeNull();
    expect(adapter.decodeLaunch({ ...legacyLog(legacy.launchCreated), address: "0x0000000000000000000000000000000000000bad" } as Log, v6)).toBeNull();
    expect(adapter.decodeLaunch({ ...legacyLog(legacy.launchCreated), removed: true } as Log, v6)).toBeNull();
    expect(adapter.decodeLaunch({ ...legacyLog(legacy.launchCreated), blockNumber: null } as unknown as Log, v6)).toBeNull();
  });
  it("rejects truncated/garbage data instead of guessing", () => {
    const l = legacyLog(legacy.launchCreated);
    expect(adapter.decodeLaunch({ ...l, data: l.data.slice(0, 200) as `0x${string}` } as Log, v6)).toBeNull();
    expect(adapter.decodeLaunch({ ...l, topics: [l.topics[0]] } as unknown as Log, v6)).toBeNull();
  });
  it("sanitizes hostile names/symbols (NUL, bidi overrides) so they can be stored and displayed", () => {
    const ev = VIBE_EVENTS.LaunchCreated;
    const args = { launchId: 1n, launcher: "0x00000000000000000000000000000000000000c1", token: "0x00000000000000000000000000000000000000a1" };
    const data = { curve: "0x00000000000000000000000000000000000000c2", name: "Evil\u0000‮token", symbol: "S\u0000Y", metadataURI: "", pairCurrency: "0x0000000000000000000000000000000000000000", taxBps: 0, packedWeights: 0n, projectTreasury: args.launcher, targetPairUnits: 0n, netPersonal: 0n, giftNetTotal: 0n, giftRoot: `0x${"0".repeat(64)}`, giftCount: 0n };
    const nonIndexed = ev.inputs.filter((i) => !("indexed" in i && i.indexed));
    const log = { address: getAddress(v6.factory), topics: encodeEventTopics({ abi: [ev], eventName: "LaunchCreated", args } as never), data: encodeAbiParameters(nonIndexed, nonIndexed.map((i) => (data as Record<string, unknown>)[i.name!]) as never), blockNumber: 1n, logIndex: 0, transactionHash: `0x${"1".repeat(64)}`, blockHash: null, removed: false } as unknown as Log;
    const d = adapter.decodeLaunch(log, v6)!;
    expect(d.name).toBe("Eviltoken");
    expect(d.symbol).toBe("SY");
    expect(d.metadataURI).toBeNull(); // empty URI = none, not ""
    expect(JSON.stringify(d.raw)).not.toContain("\\u0000");
  });
});

describe("VibeAdapter: curve events (real logs)", () => {
  it("decodes a v5 Bought as a buy by the recipient, priced in ETH", () => {
    const t = adapter.decodeTrade(asLog(live.bought))!;
    expect(t.kind).toBe("buy");
    expect(t.eventName).toBe("Bought");
    expect(t.tokenAmount > 0n && t.quoteAmount > 0n).toBe(true);
  });
  it("decodes a v5 Sold as a sell by the seller", () => {
    const t = adapter.decodeTrade(asLog(live.sold))!;
    expect(t.kind).toBe("sell");
    expect(t.eventName).toBe("Sold");
  });
  it("decodes a v6 CurveBuy", () => {
    expect(adapter.decodeTrade(legacyLog(legacy.curveBuy))?.kind).toBe("buy");
  });
  it("treats CurveCompleted as curve_completed, NOT graduation", () => {
    const g = adapter.decodeGraduation(asLog(live.curveCompleted))!;
    expect(g.kind).toBe("curve_completed");
    expect(adapter.decodeTrade(asLog(live.curveCompleted))).toBeNull();
  });
  it("decodes v5 and v6 Graduated events as graduations", () => {
    expect(adapter.decodeGraduation(asLog(live.graduatedV5))).toMatchObject({ kind: "graduated", eventName: "Graduated" });
    const g6 = adapter.decodeGraduation(asLog(live.graduatedV6))!;
    expect(g6.kind).toBe("graduated");
    expect(g6.poolId).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("does not decode a Transfer as a trade or graduation", () => {
    const transfer = { ...legacyLog(legacy.curveBuy), topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${"0".repeat(64)}`, `0x${"0".repeat(64)}`] } as unknown as Log;
    expect(adapter.decodeTrade(transfer)).toBeNull();
    expect(adapter.decodeGraduation(transfer)).toBeNull();
  });
});

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { displayText, jsonSafe, storageSafe } from "@/lib/util/sanitize";
import { TimestampResolver, ANCHOR_SPACING, type HeaderRow } from "@/indexer/timestamps";
import { parseBundle } from "@/lib/launchpads/vibe-discovery";
import { vibeDeployments } from "@/lib/vibe/contracts";

describe("string sanitisation (attacker-controlled names, symbols, metadata)", () => {
  it("removes what Postgres cannot store", () => {
    expect(storageSafe("a\u0000b")).toBe("ab");
    expect(storageSafe("x\uD800y")).toBe("xy"); // lone high surrogate
    expect(storageSafe("ok 😀")).toBe("ok 😀"); // valid pair kept
  });
  it("display text drops control and bidi characters and is capped", () => {
    expect(displayText("abc‮def\u0007")).toBe("abcdef");
    expect(displayText("line1\nline2")).toBe("line1 line2");
    expect(displayText("x".repeat(500), 10)).toHaveLength(10);
    expect(displayText(null)).toBeNull();
  });
  it("jsonSafe walks nested data with depth/size caps", () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 30; i++) cur = (cur.n = {}) as Record<string, unknown>;
    expect(JSON.stringify(jsonSafe(deep))).not.toContain('"n":{"n":{"n":{"n":{"n":{"n":{"n":{"n":{"n":{"n":{"n":{"n":{"n":{"n"');
    expect(jsonSafe({ "k\u0000": ["v\u0000", 1n] })).toEqual({ k: ["v", "1"] });
  });
});

describe("timestamps for sparse historical ranges", () => {
  it("fetches anchors only around buckets that contain events (a 10M-block span stays cheap)", async () => {
    const calls: bigint[] = [];
    const r = new TimestampResolver({ getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => (calls.push(blockNumber!), { number: blockNumber!, hash: `0x${"1".repeat(64)}`, parentHash: `0x${"2".repeat(64)}`, timestamp: 1_000n + blockNumber! / 7n }) } as never);
    // 200 events clustered in two places 10M blocks apart.
    const items = [...Array.from({ length: 100 }, (_, i) => 1_000_000n + BigInt(i)), ...Array.from({ length: 100 }, (_, i) => 11_000_000n + BigInt(i * 3))].map((b) => ({ blockNumber: b, timestamp: null as Date | null, timestampExact: undefined as boolean | undefined }));
    await r.resolve(items);
    expect(calls.length).toBeLessThanOrEqual(6);
    for (const it of items) {
      const exact = 1_000 + Number(it.blockNumber / 7n);
      expect(Math.abs(it.timestamp!.getTime() / 1000 - exact)).toBeLessThanOrEqual(Number(ANCHOR_SPACING / 7n));
    }
    // Interpolated values are labelled as such; anchor blocks themselves are exact.
    expect(items.some((i) => i.timestampExact === false)).toBe(true);
    expect(items.find((i) => i.blockNumber === 1_000_000n)?.timestampExact).toBe(true);
  });
  it("small sets are exact and labelled exact", async () => {
    const r = new TimestampResolver({ getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber!, timestamp: 5n }) } as never);
    const items = [{ blockNumber: 9n, timestamp: null as Date | null, timestampExact: undefined as boolean | undefined }];
    await r.resolve(items);
    expect(items[0].timestampExact).toBe(true);
  });
  it("uses and fills a persistent header store", async () => {
    const saved: HeaderRow[] = [];
    let rpc = 0;
    const store = { load: async (b: bigint[]) => new Map(b.filter((x) => x === 7n).map((x) => [x, 77])), save: async (rows: HeaderRow[]) => void saved.push(...rows) };
    const r = new TimestampResolver({ getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => (rpc++, { number: blockNumber!, hash: `0x${"a".repeat(64)}`, parentHash: `0x${"b".repeat(64)}`, timestamp: 100n }) } as never, store);
    const items = [7n, 8n].map((b) => ({ blockNumber: b, timestamp: null as Date | null }));
    await r.resolve(items);
    expect(rpc).toBe(1); // block 7 came from the store
    expect(items[0].timestamp!.getTime()).toBe(77_000);
    expect(saved.map((s) => s.number)).toEqual([8n]);
  });
});

describe("vibe/vibe deployment discovery from the public app bundle", () => {
  const src = fs.readFileSync("tests/fixtures/vibe-bundle-excerpt-2026-10-03.js.txt", "utf8");
  const found = parseBundle(src, "domain-shared-CzsJjBlE.js");
  it("finds the deployments the app serves", () => {
    const v6 = found.find((d) => d.key === "v6Graphs.run15")!;
    expect(v6).toMatchObject({ version: "v6", chainId: 46630, factory: "0xe794217880011f9cA6961340eD5c16EC9559Fea0", bundleDeployBlock: 123503237n });
    expect(Object.keys(v6.contracts).sort()).toEqual(["buyback", "giftLists", "hook", "locker", "pairPolicy", "poolManager", "zap"]);
    const v5 = found.find((d) => d.key === "v5Graphs.live")!;
    expect(v5.factory).toBe("0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59");
  });
  it("matches the configured deployments (a mismatch here means the config is stale)", () => {
    const configured = vibeDeployments(46630).map((d) => d.factory.toLowerCase()).sort();
    expect(found.map((d) => d.factory.toLowerCase()).sort()).toEqual(configured);
  });
  it("ignores pair tokens and pool keys", () => {
    const v6 = found.find((d) => d.version === "v6")!;
    expect(Object.values(v6.contracts)).not.toContain("0x3ab049897b0697BdA766D8730fe1F955c9c103F0"); // NVDA test asset
  });
});

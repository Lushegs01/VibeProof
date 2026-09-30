import { describe, expect, it } from "vitest";
import { interpolate, TimestampResolver, EXACT_LIMIT } from "@/indexer/timestamps";

describe("timestamp interpolation", () => {
  const ts = new Map<bigint, number>([
    [1000n, 100],
    [1500n, 185],
    [2000n, 270],
  ]);
  const anchors = [1000n, 1500n, 2000n];
  it("returns exact anchor values", () => expect(interpolate(1500n, anchors, ts)).toBe(185));
  it("interpolates linearly between the nearest anchors", () => expect(interpolate(1250n, anchors, ts)).toBe(143));
  it("is monotonic", () => {
    let prev = 0;
    for (let b = 1000n; b <= 2000n; b += 37n) {
      const t = interpolate(b, anchors, ts);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
});

describe("TimestampResolver", () => {
  const fake = (calls: bigint[]) => ({ getBlock: async ({ blockNumber }: { blockNumber: bigint }) => (calls.push(blockNumber), { timestamp: 1_000_000n + blockNumber / 6n }) }) as never;
  it("fetches small sets exactly", async () => {
    const calls: bigint[] = [];
    const r = new TimestampResolver(fake(calls));
    const items = [{ blockNumber: 600n, timestamp: null as Date | null }, { blockNumber: 1200n, timestamp: null as Date | null }];
    await r.resolve(items);
    expect(calls.sort()).toEqual([1200n, 600n].sort());
    expect(items[0].timestamp!.getTime()).toBe((1_000_000 + 100) * 1000);
  });
  it("uses anchors for large sets, with far fewer calls than blocks", async () => {
    const calls: bigint[] = [];
    const r = new TimestampResolver(fake(calls));
    const items = Array.from({ length: EXACT_LIMIT * 10 }, (_, i) => ({ blockNumber: 10_000n + BigInt(i * 7), timestamp: null as Date | null }));
    await r.resolve(items);
    expect(calls.length).toBeLessThan(items.length / 5);
    for (const it of items) {
      const exact = 1_000_000 + Number(it.blockNumber / 6n);
      expect(Math.abs(it.timestamp!.getTime() / 1000 - exact)).toBeLessThanOrEqual(1);
    }
  });
  it("does not overwrite timestamps already present", async () => {
    const calls: bigint[] = [];
    const r = new TimestampResolver(fake(calls));
    const d = new Date(0);
    const items = [{ blockNumber: 5n, timestamp: d }];
    await r.resolve(items);
    expect(calls).toEqual([]);
    expect(items[0].timestamp).toBe(d);
  });
});

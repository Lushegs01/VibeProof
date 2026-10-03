import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import { getLogsAdaptive, LogQueryError, StoppedError } from "@/lib/chain/logs";
import { TRANSFER_EVENT, VIBE_EVENTS } from "@/lib/vibe/abis";
import { FakeProvider } from "../integration/fake-provider";

const T = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`) as Address;
const Z = "0x0000000000000000000000000000000000000000";

function withTransfers(blocks: bigint[], perBlock = 1, token = T(0xaa)) {
  const p = new FakeProvider();
  p.head = 1_000_000n;
  for (const b of blocks) for (let i = 0; i < perBlock; i++) p.push(token, TRANSFER_EVENT, { from: Z, to: T(0xb0 + i) }, { value: 1n }, b);
  return p;
}

describe("getLogsAdaptive (log-limit safety)", () => {
  it("returns nothing for an empty range and for zero logs", async () => {
    const p = withTransfers([]);
    expect(await getLogsAdaptive(p, { event: TRANSFER_EVENT }, 10n, 9n)).toEqual([]);
    expect(await getLogsAdaptive(p, { event: TRANSFER_EVENT }, 1n, 100_000n)).toEqual([]);
  });

  it("returns exactly one event", async () => {
    const p = withTransfers([500n]);
    const logs = await getLogsAdaptive(p, { event: TRANSFER_EVENT }, 1n, 100_000n);
    expect(logs).toHaveLength(1);
    expect(logs[0].blockNumber).toBe(500n);
  });

  it("accepts exactly 10,000 logs in one response and splits at 10,001 without losing any", async () => {
    const at = Array.from({ length: 5_000 }, (_, i) => BigInt(1_000 + i));
    const p = withTransfers(at, 2); // 10,000 logs
    p.maxLogs = 10_000;
    const exact = await getLogsAdaptive(p, { event: TRANSFER_EVENT }, 1_000n, 5_999n, { chunk: 5_000n });
    expect(exact).toHaveLength(10_000);
    expect(p.calls.getLogs).toBe(1);

    p.push(T(0xaa), TRANSFER_EVENT, { from: Z, to: T(0xcc) }, { value: 1n }, 3_000n); // 10,001
    p.calls.getLogs = 0;
    const over = await getLogsAdaptive(p, { event: TRANSFER_EVENT }, 1_000n, 5_999n, { chunk: 5_000n });
    expect(over).toHaveLength(10_001);
    expect(p.calls.getLogs).toBeGreaterThan(2);
  });

  it("handles large event ranges by repeated halving", async () => {
    const p = withTransfers(Array.from({ length: 40_000 }, (_, i) => BigInt(i * 25 + 1)));
    p.maxLogs = 1_000;
    const logs = await getLogsAdaptive(p, { event: TRANSFER_EVENT }, 1n, 1_000_000n, { chunk: 1_000_000n });
    expect(logs).toHaveLength(40_000);
  });

  it("jumps straight to the span a provider says it allows ('only N are allowed')", async () => {
    const p = withTransfers([10n, 25_000n, 59_999n]);
    p.maxSpan = 30_000n;
    const logs = await getLogsAdaptive(p, { event: TRANSFER_EVENT }, 1n, 90_000n, { chunk: 5_000_000n });
    expect(logs.map((l) => l.blockNumber)).toEqual([10n, 25_000n, 59_999n]);
    // 1 rejected call + 3 accepted 30k windows; halving from 5M would have needed many more.
    expect(p.calls.getLogs).toBe(4);
  });

  it("splits the address list when a provider limits selectors", async () => {
    const p = withTransfers([]);
    const addrs = Array.from({ length: 1200 }, (_, i) => T(0x10_000 + i));
    for (const a of addrs.slice(0, 50)) p.push(a, TRANSFER_EVENT, { from: Z, to: T(1) }, { value: 1n }, 7n);
    const logs = await getLogsAdaptive(p, { address: addrs, event: TRANSFER_EVENT }, 1n, 10n, { maxAddresses: 400 });
    expect(logs).toHaveLength(50);
    expect(p.calls.getLogs).toBeGreaterThanOrEqual(3);
  });

  it("removes duplicates from overlapping queries and returns a deterministic order", async () => {
    const p = withTransfers([5n, 3n, 9n]);
    const dupe = { ...p.logs[0] };
    p.logs.push(dupe); // same (txHash, logIndex) served twice
    const logs = await getLogsAdaptive(p, { event: TRANSFER_EVENT }, 1n, 10n);
    expect(logs.map((l) => l.blockNumber)).toEqual([3n, 5n, 9n]);
  });

  it("ignores removed (reorged) and pending logs", async () => {
    const p = withTransfers([5n, 6n]);
    p.logs[0] = { ...p.logs[0], removed: true };
    p.logs.push({ ...p.logs[1], blockNumber: null, logIndex: 99 } as never);
    const logs = await getLogsAdaptive(p, { event: TRANSFER_EVENT }, 1n, 10n);
    expect(logs.map((l) => l.blockNumber)).toEqual([6n]);
  });

  it("never skips: a single block that exceeds the limit is an error, not a gap", async () => {
    const p = withTransfers([42n], 20);
    p.maxLogs = 5;
    await expect(getLogsAdaptive(p, { event: TRANSFER_EVENT }, 40n, 45n)).rejects.toBeInstanceOf(LogQueryError);
  });

  it("propagates provider errors (no silent partial result)", async () => {
    const p = withTransfers([5n]);
    p.failNext.push({ method: "getLogs", error: new Error("execution reverted") });
    await expect(getLogsAdaptive(p, { event: TRANSFER_EVENT }, 1n, 10n)).rejects.toThrow(/reverted/);
  });

  it("stops between requests when asked to (interrupted range)", async () => {
    const p = withTransfers([5n, 50n]);
    let n = 0;
    await expect(getLogsAdaptive(p, { event: TRANSFER_EVENT }, 1n, 100n, { chunk: 10n, shouldStop: () => ++n > 2 })).rejects.toBeInstanceOf(StoppedError);
  });

  it("filters by multiple event topics at once", async () => {
    const p = withTransfers([5n]);
    p.push(T(0xc1), VIBE_EVENTS.CurveBuy, { buyer: T(1), recipient: T(1) }, { grossTokens: 1n, netTokens: 1n, tokenFee: 0n, pairCost: 1n, pairFee: 0n, rateBps: 0n }, 6n);
    const logs = await getLogsAdaptive(p, { events: [VIBE_EVENTS.CurveBuy, VIBE_EVENTS.CurveSell] }, 1n, 10n);
    expect(logs).toHaveLength(1);
    expect(logs[0].blockNumber).toBe(6n);
  });
});

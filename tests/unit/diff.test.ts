import { describe, expect, it } from "vitest";
import { baselineFor, diffSnapshots } from "@/lib/changes/diff";

const snap = (h: number | null, t: number | null, at = "2026-09-30T00:00:00Z", vol: string | null = null) => ({ timestamp: at, holders: h, transactions: t, buyers: null, sellers: 5, volume: vol });

describe("change detection", () => {
  it("computes deltas", () => {
    const d = diffSnapshots(snap(300, 900), snap(427, 1284));
    expect(d.find((x) => x.metric === "holders")).toMatchObject({ previous: 300, current: 427, delta: 127 });
    expect(d.find((x) => x.metric === "transactions")?.delta).toBe(384);
  });
  it("omits metrics that are unknown on either side (never treats null as 0)", () => {
    const d = diffSnapshots(snap(null, 10), snap(427, 12));
    expect(d.find((x) => x.metric === "holders")).toBeUndefined();
    expect(d.find((x) => x.metric === "buyers")).toBeUndefined();
    expect(d.find((x) => x.metric === "transactions")?.delta).toBe(2);
  });
  it("returns nothing without a baseline", () => {
    expect(diffSnapshots(null, snap(1, 1))).toEqual([]);
  });
  it("diffs volume in ETH using exact bigint subtraction", () => {
    const d = diffSnapshots(snap(1, 1, undefined, "1000000000000000000"), snap(1, 1, undefined, "1370000000000000000"));
    expect(d.find((x) => x.metric === "volume")?.delta).toBeCloseTo(0.37, 10);
  });
  it("reports negative deltas", () => {
    expect(diffSnapshots(snap(10, 1), snap(7, 1)).find((x) => x.metric === "holders")?.delta).toBe(-3);
  });
});

describe("baseline selection", () => {
  const snaps = [{ timestamp: "2026-09-29T00:00:00Z" }, { timestamp: "2026-09-29T12:00:00Z" }, { timestamp: "2026-09-30T00:00:00Z" }];
  it("picks the latest snapshot at or before `since`", () => {
    expect(baselineFor(snaps, new Date("2026-09-29T18:00:00Z"))).toEqual({ baseline: snaps[1], exact: true });
  });
  it("falls back to the earliest snapshot and flags it as approximate", () => {
    expect(baselineFor(snaps, new Date("2026-09-28T00:00:00Z"))).toEqual({ baseline: snaps[0], exact: false });
  });
  it("handles empty history", () => {
    expect(baselineFor([], new Date())).toEqual({ baseline: null, exact: false });
  });
});

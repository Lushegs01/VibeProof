export type ActivityDiff = {
  metric: string;
  label: string;
  previous: number;
  current: number;
  delta: number;
};

export type SnapshotLike = {
  timestamp: Date | string;
  holders: number | null;
  transactions: number | null;
  buyers: number | null;
  sellers: number | null;
  volume: string | bigint | null;
};

const METRICS: { key: keyof SnapshotLike; label: string }[] = [
  { key: "holders", label: "holders" },
  { key: "transactions", label: "transactions" },
  { key: "buyers", label: "unique buyers" },
  { key: "sellers", label: "unique sellers" },
];

/**
 * Compare two snapshots. A metric that is null (unknown) on EITHER side is
 * omitted, never treated as 0 — an unknown→known transition is not growth.
 */
export function diffSnapshots(prev: SnapshotLike | null, curr: SnapshotLike | null): ActivityDiff[] {
  if (!prev || !curr) return [];
  const out: ActivityDiff[] = [];
  for (const { key, label } of METRICS) {
    const a = prev[key];
    const b = curr[key];
    if (typeof a !== "number" || typeof b !== "number") continue;
    out.push({ metric: key, label, previous: a, current: b, delta: b - a });
  }
  if (prev.volume !== null && curr.volume !== null && prev.volume !== undefined && curr.volume !== undefined) {
    const a = BigInt(prev.volume);
    const b = BigInt(curr.volume);
    // Volume in wei → ETH as a float is fine for display deltas.
    out.push({ metric: "volume", label: "ETH observed volume", previous: Number(a) / 1e18, current: Number(b) / 1e18, delta: Number(b - a) / 1e18 });
  }
  return out;
}

/** Pick the latest snapshot at or before `since`; if none, the earliest available (with flag). */
export function baselineFor<T extends { timestamp: Date | string }>(snaps: T[], since: Date): { baseline: T | null; exact: boolean } {
  const sorted = [...snaps].sort((x, y) => +new Date(x.timestamp) - +new Date(y.timestamp));
  let pick: T | null = null;
  for (const s of sorted) if (+new Date(s.timestamp) <= +since) pick = s;
  if (pick) return { baseline: pick, exact: true };
  return { baseline: sorted[0] ?? null, exact: false };
}

import type { Block } from "viem";
import type { ChainProvider } from "../lib/chain/provider";

/**
 * Resolves block timestamps for decoded logs.
 *
 * Robinhood Chain RPCs return `blockTimestamp: 0x0` in eth_getLogs (checked on mainnet and testnet,
 * 2026-10-03), so timestamps must come from block headers. Fetching one header per log would
 * mean hundreds of thousands of calls during a historical backfill, so:
 *
 *  - small sets (≤ EXACT_LIMIT distinct blocks): every header is fetched → exact;
 *  - larger sets: for every ANCHOR_SPACING-block bucket that CONTAINS an event, the bucket's two
 *    boundary headers are fetched and timestamps are linearly interpolated between them. Block
 *    timestamps are monotonic, so the error is bounded by the time one bucket spans (~70 s at
 *    the testnet's ~140 ms blocks). Buckets without events cost nothing, so a sparse 10M-block
 *    range is cheap.
 *
 * Each item is marked `timestampExact` so the API never presents an interpolated time as exact.
 * Fetched headers can be persisted through an optional HeaderStore (chain_blocks table).
 */
export const EXACT_LIMIT = 64;
export const ANCHOR_SPACING = 500n;

export type HeaderRow = { number: bigint; hash: `0x${string}`; parentHash: `0x${string}`; timestamp: number };

export interface HeaderStore {
  load(blocks: bigint[]): Promise<Map<bigint, number>>;
  save(rows: HeaderRow[]): Promise<void>;
}

type Item = { blockNumber: bigint; timestamp: Date | null; timestampExact?: boolean };

export class TimestampResolver {
  private cache = new Map<bigint, number>();
  constructor(
    private provider: Pick<ChainProvider, "getBlock">,
    private store?: HeaderStore,
  ) {}

  private remember(bn: bigint, t: number) {
    this.cache.set(bn, t);
    if (this.cache.size > 200_000) this.cache.delete(this.cache.keys().next().value!);
  }

  async fetchMany(blocks: bigint[], concurrency = 16) {
    let todo = [...new Set(blocks)].filter((b) => !this.cache.has(b));
    if (!todo.length) return;
    if (this.store) {
      const known = await this.store.load(todo);
      for (const [b, t] of known) this.remember(b, t);
      todo = todo.filter((b) => !this.cache.has(b));
    }
    const fetched: HeaderRow[] = [];
    for (let i = 0; i < todo.length; i += concurrency) {
      const headers = await Promise.all(todo.slice(i, i + concurrency).map((b) => this.provider.getBlock({ blockNumber: b })));
      for (const h of headers as Block[]) {
        const n = h.number ?? null;
        if (n === null) continue;
        this.remember(n, Number(h.timestamp));
        if (h.hash && h.parentHash) fetched.push({ number: n, hash: h.hash, parentHash: h.parentHash, timestamp: Number(h.timestamp) });
      }
      // Fakes may omit `number`; fall back to the requested order.
      todo.slice(i, i + concurrency).forEach((b, j) => {
        if (!this.cache.has(b)) this.remember(b, Number((headers[j] as Block).timestamp));
      });
    }
    if (this.store && fetched.length) await this.store.save(fetched);
  }

  async resolve<T extends Item>(items: T[], _head?: bigint): Promise<void> {
    const missing = [...new Set(items.filter((i) => !i.timestamp).map((i) => i.blockNumber))];
    if (!missing.length) return;
    if (missing.length <= EXACT_LIMIT) {
      await this.fetchMany(missing);
      for (const i of items)
        if (!i.timestamp) {
          i.timestamp = new Date(this.cache.get(i.blockNumber)! * 1000);
          i.timestampExact = true;
        }
      return;
    }
    const max = missing.reduce((a, b) => (b > a ? b : a));
    const anchorSet = new Set<bigint>();
    for (const b of missing) {
      const lo = (b / ANCHOR_SPACING) * ANCHOR_SPACING;
      anchorSet.add(lo);
      // Upper boundary, never above the highest event block (which exists, so it is ≤ head).
      anchorSet.add(lo + ANCHOR_SPACING < max ? lo + ANCHOR_SPACING : max);
    }
    const anchors = [...anchorSet].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    await this.fetchMany(anchors);
    for (const i of items)
      if (!i.timestamp) {
        const exact = this.cache.has(i.blockNumber);
        i.timestamp = new Date(interpolate(i.blockNumber, anchors, this.cache) * 1000);
        i.timestampExact = exact;
      }
  }
}

/**
 * Linear interpolation of a block's timestamp between the nearest anchors (sorted ascending).
 * Pure; binary search, so large anchor sets stay fast.
 */
export function interpolate(bn: bigint, anchors: bigint[], ts: Map<bigint, number>): number {
  if (ts.has(bn)) return ts.get(bn)!;
  if (!anchors.length) throw new Error("no anchors");
  let lo = 0;
  let hi = anchors.length - 1;
  if (bn <= anchors[0]) return ts.get(anchors[0])!;
  if (bn >= anchors[hi]) return ts.get(anchors[hi])!;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid] <= bn) lo = mid;
    else hi = mid;
  }
  const a = anchors[lo];
  const b = anchors[hi];
  const tA = ts.get(a)!;
  const tB = ts.get(b)!;
  if (a === b) return tA;
  return Math.round(tA + ((tB - tA) * Number(bn - a)) / Number(b - a));
}

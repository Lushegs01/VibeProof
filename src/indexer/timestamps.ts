import type { ChainProvider } from "../lib/chain/provider";

/**
 * Resolves block timestamps for decoded logs.
 *
 * The Robinhood Chain Testnet RPC returns `blockTimestamp: 0x0` in eth_getLogs, so
 * timestamps must come from block headers. Fetching one header per log would mean
 * hundreds of thousands of calls during backfill, so:
 *  - small sets (≤ EXACT_LIMIT distinct blocks): every block header is fetched → exact
 *  - larger sets: headers are fetched at ANCHOR_SPACING intervals and timestamps are
 *    linearly interpolated between the surrounding anchors. Block timestamps are
 *    monotonic, so the error is bounded by the time spanned by ANCHOR_SPACING blocks
 *    (≈ 85 s at the observed ~0.17 s block time).
 */
export const EXACT_LIMIT = 64;
export const ANCHOR_SPACING = 500n;

export class TimestampResolver {
  private cache = new Map<bigint, number>();
  constructor(private provider: ChainProvider) {}

  private async header(bn: bigint): Promise<number> {
    const hit = this.cache.get(bn);
    if (hit !== undefined) return hit;
    const b = await this.provider.getBlock({ blockNumber: bn });
    const t = Number(b.timestamp);
    this.cache.set(bn, t);
    if (this.cache.size > 100_000) this.cache.delete(this.cache.keys().next().value!);
    return t;
  }

  async fetchMany(blocks: bigint[]) {
    const todo = blocks.filter((b) => !this.cache.has(b));
    for (let i = 0; i < todo.length; i += 100) await Promise.all(todo.slice(i, i + 100).map((b) => this.header(b)));
  }

  async resolve<T extends { blockNumber: bigint; timestamp: Date | null }>(items: T[], _head?: bigint): Promise<void> {
    const missing = [...new Set(items.filter((i) => !i.timestamp).map((i) => i.blockNumber))];
    if (!missing.length) return;
    if (missing.length <= EXACT_LIMIT) {
      await this.fetchMany(missing);
      for (const i of items) if (!i.timestamp) i.timestamp = new Date(this.cache.get(i.blockNumber)! * 1000);
      return;
    }
    const min = missing.reduce((a, b) => (b < a ? b : a));
    const max = missing.reduce((a, b) => (b > a ? b : a));
    // Anchors every ANCHOR_SPACING blocks across [min, max], always including max itself (≤ head by construction).
    const anchors: bigint[] = [];
    for (let b = (min / ANCHOR_SPACING) * ANCHOR_SPACING; b < max; b += ANCHOR_SPACING) anchors.push(b);
    anchors.push(max);
    await this.fetchMany(anchors);
    for (const i of items) if (!i.timestamp) i.timestamp = new Date(interpolate(i.blockNumber, anchors, this.cache) * 1000);
  }
}

/** Linear interpolation of a block's timestamp between the nearest anchors. Pure, exported for tests. */
export function interpolate(bn: bigint, anchors: bigint[], ts: Map<bigint, number>): number {
  if (ts.has(bn)) return ts.get(bn)!;
  let lo = anchors[0];
  let hi = anchors[anchors.length - 1];
  for (const a of anchors) {
    if (a <= bn && a > lo) lo = a;
    if (a >= bn && a < hi) hi = a;
  }
  if (lo > bn) lo = anchors[0];
  const tLo = ts.get(lo)!;
  const tHi = ts.get(hi)!;
  if (hi === lo) return tLo;
  return Math.round(tLo + ((tHi - tLo) * Number(bn - lo)) / Number(hi - lo));
}

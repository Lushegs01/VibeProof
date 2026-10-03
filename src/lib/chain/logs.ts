import type { Address, Log } from "viem";
import type { ChainProvider, LogFilter } from "./provider";
import { classifyRpcError, RpcError } from "./rpc-errors";
import { log, metrics } from "../util/log";

export type AdaptiveLogOptions = {
  /** Initial block span. Defaults to the provider's documented limit for this query shape. */
  chunk?: bigint;
  /** Max addresses per request (address + topic selectors are limited by some providers). */
  maxAddresses?: number;
  shouldStop?: () => boolean;
};

export class LogQueryError extends Error {
  constructor(
    message: string,
    readonly fromBlock: bigint,
    readonly toBlock: bigint,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LogQueryError";
  }
}

export class StoppedError extends Error {
  constructor() {
    super("stopped");
    this.name = "StoppedError";
  }
}

type Filter = Omit<LogFilter, "fromBlock" | "toBlock">;

const min = (a: bigint, b: bigint) => (a < b ? a : b);

function initialSpan(p: ChainProvider, f: Filter, addresses: Address[] | null) {
  const lim = p.logLimits;
  if (!lim) return 2_000n;
  if (!addresses) return lim.topicOnlySpan;
  const values = addresses.length + (f.events?.length ?? 1);
  return values > 2 ? lim.multiValueSpan : lim.singleAddressSpan;
}

/**
 * eth_getLogs over an arbitrary range, adapting to provider limits:
 *
 *  - "logs matched by query exceeds limit" / oversized body → halve the span and retry;
 *  - "only N are allowed" / "this block range should work: [a, b]" → jump straight to that span;
 *  - "N address and topic selectors … only M allowed" → split the address list;
 *  - after a run of successes the span grows back toward its starting size.
 *
 * A range is NEVER skipped: if even a single block cannot be fetched the call throws, so the
 * caller does not advance its cursor. Results are de-duplicated by (txHash, logIndex), stripped
 * of `removed` logs and of anything outside [fromBlock, toBlock], and sorted by (block, logIndex),
 * so overlapping or repeated queries are deterministic.
 */
export async function getLogsAdaptive(provider: ChainProvider, filter: Filter, fromBlock: bigint, toBlock: bigint, opts: AdaptiveLogOptions = {}): Promise<Log[]> {
  if (fromBlock > toBlock) return [];
  const addresses = filter.address ? (Array.isArray(filter.address) ? [...new Set(filter.address.map((a) => a.toLowerCase() as Address))] : [filter.address]) : null;
  if (addresses && addresses.length === 0) return [];
  const topics = filter.events?.length ?? 1;
  const maxAddr = Math.max(1, (opts.maxAddresses ?? provider.logLimits?.maxSelectors ?? 500) - topics);
  if (addresses && addresses.length > maxAddr) {
    const out: Log[] = [];
    for (let i = 0; i < addresses.length; i += maxAddr) out.push(...(await getLogsAdaptive(provider, { ...filter, address: addresses.slice(i, i + maxAddr) }, fromBlock, toBlock, opts)));
    return finalize(out, fromBlock, toBlock);
  }
  const out = await scan(provider, { ...filter, address: addresses ? (addresses.length === 1 ? addresses[0] : addresses) : undefined }, addresses, fromBlock, toBlock, opts);
  return finalize(out, fromBlock, toBlock);
}

async function scan(provider: ChainProvider, filter: Filter, addresses: Address[] | null, fromBlock: bigint, toBlock: bigint, opts: AdaptiveLogOptions): Promise<Log[]> {
  const start0 = opts.chunk ?? initialSpan(provider, filter, addresses);
  let span = start0 > 0n ? start0 : 1n;
  let start = fromBlock;
  let streak = 0;
  const out: Log[] = [];
  while (start <= toBlock) {
    if (opts.shouldStop?.()) throw new StoppedError();
    const end = min(start + span - 1n, toBlock);
    try {
      out.push(...(await provider.getLogs({ ...filter, fromBlock: start, toBlock: end })));
      start = end + 1n;
      if (++streak >= 4 && span < start0) {
        span = min(span * 2n, start0);
        streak = 0;
      }
    } catch (e) {
      const info = e instanceof RpcError ? e.info : classifyRpcError(e);
      streak = 0;
      if (info.kind === "too_many_selectors" && addresses && addresses.length > 1) {
        const half = Math.ceil(addresses.length / 2);
        log("debug", "indexer.logs_split_addresses", { from: start, to: toBlock, addresses: addresses.length });
        for (const part of [addresses.slice(0, half), addresses.slice(half)])
          out.push(...(await scan(provider, { ...filter, address: part.length === 1 ? part[0] : part }, part, start, toBlock, opts)));
        return out;
      }
      if (info.kind !== "range_too_large") throw e;
      metrics.inc("logs.range_shrinks");
      const width = end - start + 1n;
      let next = width / 2n;
      if (info.suggestedTo !== undefined && info.suggestedTo >= start && info.suggestedTo < end) next = info.suggestedTo - start + 1n;
      else if (info.maxSpan !== undefined && info.maxSpan > 0n && info.maxSpan < width) next = info.maxSpan;
      if (next >= 1n && next < width) {
        span = next;
        log("debug", "indexer.logs_shrink", { from: start, span: width, next, reason: info.message });
        continue;
      }
      // A single block is still too much for one query.
      if (addresses && addresses.length > 1) {
        const half = Math.ceil(addresses.length / 2);
        for (const part of [addresses.slice(0, half), addresses.slice(half)])
          out.push(...(await scan(provider, { ...filter, address: part.length === 1 ? part[0] : part }, part, start, end, { ...opts, chunk: 1n })));
        start = end + 1n;
        continue;
      }
      throw new LogQueryError(`Block ${start} alone exceeds the provider's log limit for this query; refusing to skip it`, start, end, { cause: e });
    }
  }
  return out;
}

function finalize(logs: Log[], fromBlock: bigint, toBlock: bigint): Log[] {
  const seen = new Set<string>();
  const out: Log[] = [];
  for (const l of logs) {
    if (l.removed || l.blockNumber === null || l.blockNumber === undefined || l.logIndex === null || l.logIndex === undefined || !l.transactionHash) continue;
    if (l.blockNumber < fromBlock || l.blockNumber > toBlock) continue;
    const k = `${l.transactionHash}:${l.logIndex}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out.sort((a, b) => (a.blockNumber! === b.blockNumber! ? a.logIndex! - b.logIndex! : a.blockNumber! < b.blockNumber! ? -1 : 1));
}

/** @deprecated use getLogsAdaptive (kept for existing callers). */
export function getLogsChunked(provider: ChainProvider, args: Filter, fromBlock: bigint, toBlock: bigint, chunk = 2_000n) {
  return getLogsAdaptive(provider, args, fromBlock, toBlock, { chunk });
}

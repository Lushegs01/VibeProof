import {
  createPublicClient,
  http,
  type Abi,
  type AbiEvent,
  type Address,
  type Block,
  type Hash,
  type Hex,
  type Log,
  type PublicClient,
  type Transaction,
  type TransactionReceipt,
} from "viem";
import { getChainConfig, activeNetworkSlug, type NetworkSlug } from "./chains";
import type { LogLimits } from "./networks";
import { classifyRpcError, isRangeError, RpcError, redactSecrets, type RpcErrorInfo, type RpcErrorKind } from "./rpc-errors";
import { log, metrics } from "../util/log";

/**
 * The only way application code talks to a chain. Swap the implementation (public RPC,
 * Alchemy, a local anvil fork, an in-memory fake) without touching callers.
 */
export type LogFilter = {
  address?: Address | Address[];
  event?: AbiEvent;
  events?: readonly AbiEvent[];
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
};

export type ChainProvider = {
  slug: NetworkSlug;
  chainId: number;
  /** Starting points for log-query chunking; adapted at runtime from provider error messages. */
  logLimits?: LogLimits;
  /** eth_chainId as reported by the endpoint (used to refuse a misconfigured RPC URL). */
  getChainId?(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber?: bigint; blockTag?: "latest" | "safe" | "finalized" }): Promise<Block>;
  getLogs<E extends AbiEvent>(args: LogFilter & { event?: E }): Promise<Log[]>;
  readContract<T = unknown>(args: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<T>;
  multicall(args: { contracts: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }[] }): Promise<
    ({ status: "success"; result: unknown } | { status: "failure"; error: Error })[]
  >;
  getBytecode(address: Address): Promise<Hex | undefined>;
  getStorageAt(address: Address, slot: Hex): Promise<Hex | undefined>;
  getTransaction(hash: Hash): Promise<Transaction | null>;
  getTransactionReceipt(hash: Hash): Promise<TransactionReceipt | null>;
  getBalance(address: Address): Promise<bigint>;
  stats?(): ProviderStats;
};

// ── Telemetry ────────────────────────────────────────────────────────────────

export type ProviderStats = {
  requests: number;
  succeeded: number;
  failed: number;
  retries: number;
  rateLimited: number;
  rangeSplits: number;
  byKind: Partial<Record<RpcErrorKind, number>>;
  byMethod: Record<string, { calls: number; errors: number; msTotal: number }>;
  /** Over the last 5 minutes: failed attempts / attempts (attempts include retries). null = no traffic. */
  errorRate5m: number | null;
  attempts5m: number;
  lastError: { at: string; method: string; kind: RpcErrorKind; message: string } | null;
};

class Telemetry {
  s: Omit<ProviderStats, "errorRate5m" | "attempts5m"> = { requests: 0, succeeded: 0, failed: 0, retries: 0, rateLimited: 0, rangeSplits: 0, byKind: {}, byMethod: {}, lastError: null };
  /** Per-10s buckets for the rolling window: [bucketStart, attempts, failures]. */
  private window: [number, number, number][] = [];

  attempt(ok: boolean) {
    const b = Math.floor(Date.now() / 10_000) * 10_000;
    const last = this.window[this.window.length - 1];
    if (last && last[0] === b) {
      last[1]++;
      if (!ok) last[2]++;
    } else this.window.push([b, 1, ok ? 0 : 1]);
    const cutoff = Date.now() - 300_000;
    while (this.window.length && this.window[0][0] < cutoff) this.window.shift();
  }
  snapshot(): ProviderStats {
    const cutoff = Date.now() - 300_000;
    let a = 0;
    let f = 0;
    for (const [t, n, e] of this.window) if (t >= cutoff) ((a += n), (f += e));
    return { ...structuredClone(this.s), errorRate5m: a ? f / a : null, attempts5m: a };
  }
}

// ── Concurrency + shared rate-limit gate ───────────────────────────────────

/** Semaphore so one page or backfill can never fan out into hundreds of concurrent RPC calls. */
export function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RetryPolicy = { baseMs: number; maxMs: number; maxAttempts: Partial<Record<RpcErrorKind, number>> };

export const DEFAULT_RETRY: RetryPolicy = {
  baseMs: 500,
  maxMs: 30_000,
  // Retries AFTER the first attempt. Range/selector/permanent/not_found errors are never retried here.
  maxAttempts: { rate_limited: 8, timeout: 4, transient: 5, unknown: 2 },
};

/** Exponential backoff with full jitter (AWS-style), capped. Honors a provider Retry-After. */
export function backoffMs(attempt: number, policy: RetryPolicy, info?: RpcErrorInfo, rand = Math.random) {
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** attempt);
  const jittered = Math.round(exp * (0.5 + rand() * 0.5));
  return Math.max(jittered, info?.retryAfterMs ?? 0);
}

/**
 * Wrap an RPC call: concurrency limit, shared 429 cooldown, classified retries, telemetry.
 * Exported for tests (drive it with any async function).
 */
export function createCaller(opts: { maxConcurrency: number; policy?: RetryPolicy; telemetry?: Telemetry; label?: string; sleepFn?: (ms: number) => Promise<unknown> }) {
  const limit = limiter(opts.maxConcurrency);
  const policy = opts.policy ?? DEFAULT_RETRY;
  const tel = opts.telemetry ?? new Telemetry();
  const doSleep = opts.sleepFn ?? sleep;
  let pauseUntil = 0;
  let lastRateLog = 0;

  async function call<T>(method: string, fn: () => Promise<T>): Promise<T> {
    tel.s.requests++;
    const m = (tel.s.byMethod[method] ??= { calls: 0, errors: 0, msTotal: 0 });
    m.calls++;
    metrics.inc(`rpc.${method}`);
    for (let attempt = 0; ; attempt++) {
      // A 429 anywhere pauses every request on this provider: avoids a thundering herd of retries.
      const wait = pauseUntil - Date.now();
      if (wait > 0) await doSleep(wait);
      const t0 = Date.now();
      try {
        const res = await limit(fn);
        m.msTotal += Date.now() - t0;
        tel.attempt(true);
        tel.s.succeeded++;
        return res;
      } catch (e) {
        m.msTotal += Date.now() - t0;
        const info = classifyRpcError(e);
        tel.attempt(false);
        tel.s.byKind[info.kind] = (tel.s.byKind[info.kind] ?? 0) + 1;
        if (isRangeError(info.kind)) {
          // Expected while chunking: the caller narrows the query. Not a provider failure.
          tel.s.rangeSplits++;
          metrics.inc("rpc.range_splits");
          throw new RpcError(info, method, { cause: e });
        }
        const max = policy.maxAttempts[info.kind] ?? 0;
        if (attempt >= max) {
          m.errors++;
          tel.s.failed++;
          tel.s.lastError = { at: new Date().toISOString(), method, kind: info.kind, message: info.message };
          metrics.inc("rpc.failures");
          log(info.kind === "not_found" ? "debug" : "warn", "indexer.provider_error", { network: opts.label, method, kind: info.kind, status: info.status, attempts: attempt + 1, error: info.message });
          throw new RpcError(info, method, { cause: e });
        }
        const delay = backoffMs(attempt, policy, info);
        tel.s.retries++;
        metrics.inc("rpc.retries");
        if (info.kind === "rate_limited") {
          tel.s.rateLimited++;
          metrics.inc("rpc.rate_limited");
          pauseUntil = Math.max(pauseUntil, Date.now() + delay);
          if (Date.now() - lastRateLog > 10_000) {
            lastRateLog = Date.now();
            log("warn", "indexer.rpc_rate_limited", { network: opts.label, method, backoffMs: delay, retryAfterMs: info.retryAfterMs ?? null });
          }
        } else {
          log("debug", "indexer.rpc_retry", { network: opts.label, method, kind: info.kind, attempt: attempt + 1, backoffMs: delay, error: info.message });
        }
        await doSleep(delay);
      }
    }
  }
  return { call, telemetry: tel };
}

/** Collapse concurrent identical read-only requests into one in-flight promise. */
function deduper() {
  const inflight = new Map<string, Promise<unknown>>();
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const hit = inflight.get(key);
    if (hit) {
      metrics.inc("rpc.deduped");
      return hit as Promise<T>;
    }
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

const keyOf = (...parts: unknown[]) => JSON.stringify(parts, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export function createViemProvider(slug: NetworkSlug = activeNetworkSlug(), opts: { maxConcurrency?: number; timeoutMs?: number; rpcUrl?: string; policy?: RetryPolicy } = {}): ChainProvider {
  const cfg = getChainConfig(slug);
  if (!cfg) throw new Error(`Unsupported network: ${slug}`);
  const rpcUrl = opts.rpcUrl ?? cfg.rpcUrl;
  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(rpcUrl, {
      timeout: opts.timeoutMs ?? Number(process.env.RPC_TIMEOUT_MS ?? 20_000),
      retryCount: 0, // retries are classified and handled here
      maxResponseBodySize: Number(process.env.RPC_MAX_RESPONSE_BYTES ?? 10 * 1024 * 1024),
    }),
    batch: { multicall: { wait: 8 } },
  }) as PublicClient;
  const { call, telemetry } = createCaller({ maxConcurrency: opts.maxConcurrency ?? Number(process.env.RPC_MAX_CONCURRENCY ?? 8), policy: opts.policy, label: slug });
  const dedupe = deduper();
  const nullIfNotFound = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      if (classifyRpcError(e).kind === "not_found") return null;
      throw e;
    }
  };

  return {
    slug,
    chainId: cfg.chainId,
    logLimits: cfg.logLimits,
    getChainId: () => dedupe("chainid", () => call("eth_chainId", () => client.getChainId())),
    getBlockNumber: () => dedupe("bn", () => call("eth_blockNumber", () => client.getBlockNumber({ cacheTime: 1_000 }))),
    getBlock: (args) =>
      args.blockNumber !== undefined
        ? dedupe(keyOf("block", args.blockNumber), () => call("eth_getBlockByNumber", () => client.getBlock({ blockNumber: args.blockNumber! })))
        : call("eth_getBlockByNumber", () => client.getBlock({ blockTag: args.blockTag ?? "latest" })),
    getLogs: (args) =>
      dedupe(keyOf("logs", args.address, args.event?.name, args.events?.map((e) => e.name), args.args, args.fromBlock, args.toBlock), () =>
        call("eth_getLogs", () =>
          client.getLogs({
            address: args.address,
            event: args.event as AbiEvent | undefined,
            events: args.events as AbiEvent[] | undefined,
            args: args.args as never,
            fromBlock: args.fromBlock,
            toBlock: args.toBlock,
            strict: false,
          } as never) as Promise<Log[]>,
        ),
      ),
    readContract: <T,>(args: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }) => call("eth_call", () => client.readContract(args as never) as Promise<T>),
    // Large calldata chunks: fewer parallel eth_calls per multicall (each chunk bypasses the limiter).
    // With allowFailure, transport errors come back as per-call failures; callers classify them.
    multicall: (args) => call("multicall", () => client.multicall({ contracts: args.contracts as never, allowFailure: true, batchSize: 16_384 }) as never),
    getBytecode: (address) => dedupe(keyOf("code", address), () => call("eth_getCode", () => client.getCode({ address }))),
    getStorageAt: (address, slot) => dedupe(keyOf("slot", address, slot), () => call("eth_getStorageAt", () => client.getStorageAt({ address, slot }))),
    getTransaction: (hash) => dedupe(keyOf("tx", hash), () => call("eth_getTransactionByHash", () => nullIfNotFound(() => client.getTransaction({ hash })))),
    getTransactionReceipt: (hash) => dedupe(keyOf("rcpt", hash), () => call("eth_getTransactionReceipt", () => nullIfNotFound(() => client.getTransactionReceipt({ hash })))),
    getBalance: (address) => call("eth_getBalance", () => client.getBalance({ address })),
    stats: () => telemetry.snapshot(),
  };
}

const providers = new Map<NetworkSlug, ChainProvider>();
/** Process-wide provider per network (shared concurrency cap and rate-limit gate). */
export function getProvider(slug: NetworkSlug = activeNetworkSlug()): ChainProvider {
  let p = providers.get(slug);
  if (!p) providers.set(slug, (p = createViemProvider(slug)));
  return p;
}

/** Throws if the endpoint serves a different chain than the network it is configured for. */
export async function assertChainId(provider: ChainProvider) {
  if (!provider.getChainId) return;
  const actual = await provider.getChainId();
  if (actual !== provider.chainId) throw new Error(`RPC for ${provider.slug} reports chain id ${actual}, expected ${provider.chainId}. Check the network's RPC URL.`);
}

export { redactSecrets };

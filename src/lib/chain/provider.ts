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
import { getChainConfig, type ChainSlug } from "./chains";
import { withRetry } from "../util/retry";
import { log, metrics } from "../util/log";

/**
 * The only way application code talks to a chain. Swap the implementation
 * (public RPC, Alchemy, a local anvil fork, a recorded fixture) without
 * touching callers.
 */
export type ChainProvider = {
  slug: ChainSlug;
  chainId: number;
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber?: bigint; blockTag?: "latest" | "safe" | "finalized" }): Promise<Block>;
  getLogs<E extends AbiEvent>(args: {
    address?: Address | Address[];
    event?: E;
    events?: readonly AbiEvent[];
    args?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<Log[]>;
  readContract<T = unknown>(args: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<T>;
  multicall(args: { contracts: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }[] }): Promise<
    ({ status: "success"; result: unknown } | { status: "failure"; error: Error })[]
  >;
  getBytecode(address: Address): Promise<Hex | undefined>;
  getStorageAt(address: Address, slot: Hex): Promise<Hex | undefined>;
  getTransaction(hash: Hash): Promise<Transaction | null>;
  getTransactionReceipt(hash: Hash): Promise<TransactionReceipt | null>;
  getBalance(address: Address): Promise<bigint>;
};

/** Simple semaphore so one page can never fan out into hundreds of concurrent RPC calls. */
function limiter(max: number) {
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

const RETRYABLE = /(429|too many requests|rate limit|timeout|timed out|ECONNRESET|fetch failed|503|502|504|socket|unknown RPC error|HTTP request failed)/i;

// "logs matched by query exceeds limit of 10000" (surfaced by viem as "Missing or invalid parameters"),
// oversized response bodies, and provider-specific block-range errors. NOT rate limiting (429).
const RANGE_ERROR = /(block range|range too (large|wide)|too many (logs|results)|exceeds limit|query returned more than|Missing or invalid parameters|size limit)/i;

function isNotFound(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /not found|could not be found/i.test(msg);
}

export function createViemProvider(slug: ChainSlug = "robinhood-testnet", opts: { maxConcurrency?: number } = {}): ChainProvider {
  const cfg = getChainConfig(slug);
  if (!cfg) throw new Error(`Unsupported chain: ${slug}`);
  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpcUrl, { timeout: 15_000, retryCount: 0 }),
    batch: { multicall: { wait: 8 } },
  }) as PublicClient;
  const limit = limiter(opts.maxConcurrency ?? Number(process.env.RPC_MAX_CONCURRENCY ?? 12));

  const call = <T>(name: string, fn: () => Promise<T>) =>
    limit(() =>
      withRetry(
        async () => {
          metrics.inc(`rpc.${name}`);
          try {
            return await fn();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // Oversized getLogs ranges are expected; getLogsChunked halves the range and retries.
            const expected = name === "eth_getLogs" && RANGE_ERROR.test(msg) && !/too many requests/i.test(msg);
            metrics.inc(expected ? "rpc.range_splits" : "rpc.failures");
            log(expected ? "debug" : "warn", "rpc.failure", { method: name, error: msg.slice(0, 200) });
            throw e;
          }
        },
        { retries: 5, baseMs: 500, maxMs: 15_000, shouldRetry: (e) => RETRYABLE.test(e instanceof Error ? e.message : String(e)) && !RANGE_ERROR.test(e instanceof Error ? e.message : String(e)) },
      ),
    );

  return {
    slug,
    chainId: cfg.chain.id,
    getBlockNumber: () => call("eth_blockNumber", () => client.getBlockNumber({ cacheTime: 2_000 })),
    getBlock: (args) =>
      call("eth_getBlockByNumber", () =>
        args.blockNumber !== undefined ? client.getBlock({ blockNumber: args.blockNumber }) : client.getBlock({ blockTag: args.blockTag ?? "latest" }),
      ),
    getLogs: (args) =>
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
    readContract: <T,>(args: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }) =>
      call("eth_call", () => client.readContract(args as never) as Promise<T>),
    multicall: (args) =>
      call("multicall", () => client.multicall({ contracts: args.contracts as never, allowFailure: true }) as never),
    getBytecode: (address) => call("eth_getCode", () => client.getCode({ address })),
    getStorageAt: (address, slot) => call("eth_getStorageAt", () => client.getStorageAt({ address, slot })),
    getTransaction: (hash) =>
      call("eth_getTransactionByHash", async () => {
        try {
          return await client.getTransaction({ hash });
        } catch (e) {
          if (isNotFound(e)) return null;
          throw e;
        }
      }),
    getTransactionReceipt: (hash) =>
      call("eth_getTransactionReceipt", async () => {
        try {
          return await client.getTransactionReceipt({ hash });
        } catch (e) {
          if (isNotFound(e)) return null;
          throw e;
        }
      }),
    getBalance: (address) => call("eth_getBalance", () => client.getBalance({ address })),
  };
}

let singleton: ChainProvider | null = null;
export function getProvider(): ChainProvider {
  singleton ??= createViemProvider("robinhood-testnet");
  return singleton;
}

/** Fetch logs over a large range in bounded chunks, halving on "range too large" errors. */
export async function getLogsChunked(
  provider: ChainProvider,
  args: Omit<Parameters<ChainProvider["getLogs"]>[0], "fromBlock" | "toBlock">,
  fromBlock: bigint,
  toBlock: bigint,
  chunk = 2_000n,
): Promise<Log[]> {
  const out: Log[] = [];
  let start = fromBlock;
  let size = chunk;
  while (start <= toBlock) {
    const end = start + size - 1n > toBlock ? toBlock : start + size - 1n;
    try {
      out.push(...(await provider.getLogs({ ...args, fromBlock: start, toBlock: end })));
      start = end + 1n;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (size > 1n && RANGE_ERROR.test(msg) && !/too many requests/i.test(msg)) {
        size /= 2n;
        continue;
      }
      throw e;
    }
  }
  return out;
}

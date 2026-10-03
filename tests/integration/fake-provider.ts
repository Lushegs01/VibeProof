import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, toEventSelector, toHex, type AbiEvent, type Address, type Log } from "viem";
import type { ChainProvider } from "@/lib/chain/provider";

/**
 * In-memory ChainProvider with real eth_getLogs filtering semantics, deterministic block hashes
 * (so reorgs can be simulated), provider-style limits and injectable failures.
 */
export class FakeProvider implements ChainProvider {
  slug = "robinhood-testnet" as const;
  chainId = 46630;
  logs: Log[] = [];
  head = 1_000n;
  calls = { getLogs: 0, getBlock: 0, multicall: 0 };
  code = new Map<string, `0x${string}`>();
  owners = new Map<string, Address>();
  /** Simulated provider limits. */
  maxLogs = Infinity;
  maxSpan: bigint | null = null;
  /** Tokens whose ERC-20 view calls revert. */
  reverting = new Set<string>();
  /** Errors thrown by the next N calls of a method. */
  failNext: { method: "getLogs" | "getBlock" | "multicall" | "getBlockNumber"; error: Error }[] = [];
  /** Blocks >= forkFrom hash differently (fork id) after a simulated reorg. */
  private forkFrom: bigint | null = null;
  private forkId = 0;
  logLimits = { topicOnlySpan: 1_000_000n, multiValueSpan: 1_000_000n, singleAddressSpan: 1_000_000n, maxSelectors: 500 };

  hashOf(n: bigint): `0x${string}` {
    const fork = this.forkFrom !== null && n >= this.forkFrom ? this.forkId : 0;
    return keccak256(toHex(`${n}:${fork}`));
  }
  private maybeFail(method: FakeProvider["failNext"][number]["method"]) {
    const i = this.failNext.findIndex((f) => f.method === method);
    if (i >= 0) throw this.failNext.splice(i, 1)[0].error;
  }

  async getChainId() {
    return this.chainId;
  }
  async getBlockNumber() {
    this.maybeFail("getBlockNumber");
    return this.head;
  }
  async getBlock({ blockNumber }: { blockNumber?: bigint }) {
    this.calls.getBlock++;
    this.maybeFail("getBlock");
    const n = blockNumber ?? this.head;
    if (n > this.head) throw Object.assign(new Error(`Block at number "${n}" could not be found.`), { name: "BlockNotFoundError" });
    return { number: n, hash: this.hashOf(n), parentHash: n > 0n ? this.hashOf(n - 1n) : `0x${"0".repeat(64)}`, timestamp: 1_790_000_000n + n } as never;
  }
  async getLogs(args: { address?: Address | Address[]; event?: AbiEvent; events?: readonly AbiEvent[]; fromBlock: bigint; toBlock: bigint }) {
    this.calls.getLogs++;
    this.maybeFail("getLogs");
    if (this.maxSpan !== null && args.toBlock - args.fromBlock + 1n > this.maxSpan)
      throw new Error(`query spans ${args.toBlock - args.fromBlock + 1n} blocks (${args.fromBlock} to ${args.toBlock}), but only ${this.maxSpan} are allowed for this request; narrow the block range, or add an address filter`);
    const addrs = args.address ? new Set((Array.isArray(args.address) ? args.address : [args.address]).map((a) => a.toLowerCase())) : null;
    const topics = new Set([...(args.event ? [args.event] : []), ...(args.events ?? [])].map((e) => toEventSelector(e)));
    const out = this.logs
      .filter((l) => l.blockNumber! >= args.fromBlock && l.blockNumber! <= args.toBlock && l.blockNumber! <= this.head && (!addrs || addrs.has(l.address.toLowerCase())) && (!topics.size || topics.has(l.topics[0]!)))
      .map((l) => ({ ...l, blockHash: this.hashOf(l.blockNumber!) }));
    if (out.length > this.maxLogs) throw new Error(`logs matched by query exceeds limit of ${this.maxLogs}`);
    return out;
  }
  async readContract<T>(args: { address: Address; functionName: string }): Promise<T> {
    if (args.functionName === "owner" && this.owners.has(args.address.toLowerCase())) return this.owners.get(args.address.toLowerCase()) as T;
    throw new Error("execution reverted");
  }
  async multicall(args: { contracts: { address: Address; functionName: string }[] }) {
    this.calls.multicall++;
    this.maybeFail("multicall");
    return args.contracts.map((c) => {
      if (this.reverting.has(c.address.toLowerCase())) return { status: "failure" as const, error: new Error("execution reverted") };
      const tail = c.address.slice(-2);
      const result = c.functionName === "symbol" ? `SYM${tail}` : c.functionName === "name" ? `Name ${tail}` : c.functionName === "decimals" ? 18 : c.functionName === "totalSupply" ? 10n ** 27n : null;
      return { status: "success" as const, result };
    });
  }
  async getBytecode(a: Address) {
    return this.code.get(a.toLowerCase());
  }
  async getStorageAt() {
    return "0x" as `0x${string}`;
  }
  async getTransaction() {
    return null;
  }
  async getTransactionReceipt() {
    return null;
  }
  async getBalance() {
    return 0n;
  }

  private nextIndex = 0;
  /** Append a log (tx hash/log index unique per push). */
  push<E extends AbiEvent>(address: Address, event: E, indexed: Record<string, unknown>, data: Record<string, unknown>, block: bigint, opts: { txHash?: `0x${string}`; logIndex?: number } = {}) {
    const topics = encodeEventTopics({ abi: [event], eventName: event.name, args: indexed } as never);
    const nonIndexed = event.inputs.filter((i) => !i.indexed);
    const encoded = encodeAbiParameters(nonIndexed, nonIndexed.map((i) => data[i.name!]) as never);
    const idx = this.nextIndex++;
    const log = {
      address: getAddress(address),
      topics: topics as never,
      data: encoded,
      blockNumber: block,
      transactionHash: opts.txHash ?? (`0x${idx.toString(16).padStart(64, "0")}` as `0x${string}`),
      logIndex: opts.logIndex ?? idx,
      blockHash: this.hashOf(block),
      transactionIndex: 0,
      removed: false,
      blockTimestamp: 0n,
    } as unknown as Log;
    this.logs.push(log);
    return log;
  }

  /**
   * Simulate a reorg: every block >= `from` gets a new hash, and the logs in those blocks are
   * dropped (the caller pushes the replacement fork's logs afterwards).
   */
  reorg(from: bigint) {
    this.forkFrom = from;
    this.forkId++;
    this.logs = this.logs.filter((l) => l.blockNumber! < from);
  }
}

import { encodeAbiParameters, encodeEventTopics, getAddress, toEventSelector, type AbiEvent, type Address, type Log } from "viem";
import type { ChainProvider } from "@/lib/chain/provider";

/** In-memory ChainProvider: serves a fixed set of logs with real eth_getLogs filtering semantics. */
export class FakeProvider implements ChainProvider {
  slug = "robinhood-testnet" as const;
  chainId = 46630;
  logs: Log[] = [];
  head = 1_000n;
  calls = { getLogs: 0, getBlock: 0 };
  code = new Map<string, `0x${string}`>();
  owners = new Map<string, Address>();

  async getBlockNumber() {
    return this.head;
  }
  async getBlock({ blockNumber }: { blockNumber?: bigint }) {
    this.calls.getBlock++;
    return { timestamp: 1_790_000_000n + (blockNumber ?? this.head) } as never;
  }
  async getLogs(args: { address?: Address | Address[]; event?: AbiEvent; events?: readonly AbiEvent[]; fromBlock: bigint; toBlock: bigint }) {
    this.calls.getLogs++;
    const addrs = args.address ? new Set((Array.isArray(args.address) ? args.address : [args.address]).map((a) => a.toLowerCase())) : null;
    const topics = new Set([...(args.event ? [args.event] : []), ...(args.events ?? [])].map((e) => toEventSelector(e)));
    return this.logs.filter((l) => l.blockNumber! >= args.fromBlock && l.blockNumber! <= args.toBlock && (!addrs || addrs.has(l.address.toLowerCase())) && (!topics.size || topics.has(l.topics[0]!)));
  }
  async readContract<T>(args: { address: Address; functionName: string }): Promise<T> {
    if (args.functionName === "owner" && this.owners.has(args.address.toLowerCase())) return this.owners.get(args.address.toLowerCase()) as T;
    throw new Error("execution reverted");
  }
  async multicall(args: { contracts: { address: Address; functionName: string }[] }) {
    return args.contracts.map((c) => ({ status: "success" as const, result: c.functionName === "symbol" ? `SYM${c.address.slice(-2)}` : `Name ${c.address.slice(-2)}` }));
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
  push<E extends AbiEvent>(address: Address, event: E, indexed: Record<string, unknown>, data: Record<string, unknown>, block: bigint) {
    const topics = encodeEventTopics({ abi: [event], eventName: event.name, args: indexed } as never);
    const nonIndexed = event.inputs.filter((i) => !i.indexed);
    const encoded = encodeAbiParameters(nonIndexed, nonIndexed.map((i) => data[i.name!]) as never);
    const idx = this.nextIndex++;
    this.logs.push({
      address: getAddress(address),
      topics: topics as never,
      data: encoded,
      blockNumber: block,
      transactionHash: `0x${idx.toString(16).padStart(64, "0")}`,
      logIndex: idx,
      blockHash: `0x${"0".repeat(64)}`,
      transactionIndex: 0,
      removed: false,
      blockTimestamp: 0n,
    } as unknown as Log);
  }
}

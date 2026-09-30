import { decodeEventLog, getAddress, type Address, type Log } from "viem";
import { VIBE_EVENTS, TRANSFER_EVENT } from "../lib/vibe/abis";
import type { VibeDeployment } from "../lib/vibe/contracts";

/** Pure log → domain decoding. No IO, fully unit-testable. */

export type DecodedLaunch = {
  deploymentId: string;
  factory: Address;
  launchId: bigint;
  token: Address;
  creator: Address;
  curve: Address;
  pairCurrency: Address | null;
  name: string | null;
  symbol: string | null;
  metadataURI: string | null;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  timestamp: Date | null;
  raw: Record<string, unknown>;
};

export type DecodedTrade = {
  kind: "buy" | "sell";
  curve: Address;
  trader: Address;
  tokenAmount: bigint;
  /** Amount of pair currency (ETH for v5 / ETH-paired v6). */
  quoteAmount: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  timestamp: Date | null;
};

export type DecodedTransfer = {
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  timestamp: Date | null;
};

export function logTimestamp(log: Log): Date | null {
  const t = (log as unknown as { blockTimestamp?: string | bigint | number }).blockTimestamp;
  if (t === undefined || t === null) return null;
  const n = typeof t === "string" ? Number(BigInt(t)) : Number(t);
  // Some RPC nodes return 0x0 for historical logs — treat that as "unknown", never epoch.
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

const jsonSafe = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

export function decodeLaunch(log: Log, dep: VibeDeployment): DecodedLaunch | null {
  try {
    const base = {
      deploymentId: dep.id,
      factory: getAddress(log.address),
      txHash: log.transactionHash!,
      blockNumber: log.blockNumber!,
      logIndex: log.logIndex!,
      timestamp: logTimestamp(log),
    };
    if (dep.launchEvent === "LaunchCreated") {
      const { args } = decodeEventLog({ abi: [VIBE_EVENTS.LaunchCreated], data: log.data, topics: log.topics as never });
      return {
        ...base,
        launchId: args.launchId,
        token: getAddress(args.token),
        creator: getAddress(args.launcher),
        curve: getAddress(args.curve),
        pairCurrency: getAddress(args.pairCurrency),
        name: args.name,
        symbol: args.symbol,
        metadataURI: args.metadataURI || null,
        raw: jsonSafe(args as never),
      };
    }
    const { args } = decodeEventLog({ abi: [VIBE_EVENTS.TokenLaunched], data: log.data, topics: log.topics as never });
    return {
      ...base,
      launchId: args.launchId,
      token: getAddress(args.token),
      creator: getAddress(args.creator),
      curve: getAddress(args.curve),
      pairCurrency: null, // v5 curves are ETH-denominated (Bought/Sold carry ETH amounts)
      name: null,
      symbol: null,
      metadataURI: args.metadataURI || null,
      raw: jsonSafe(args as never),
    };
  } catch {
    return null;
  }
}

const TRADE_ABI = [VIBE_EVENTS.CurveBuy, VIBE_EVENTS.CurveSell, VIBE_EVENTS.Bought, VIBE_EVENTS.Sold] as const;

export function decodeTrade(log: Log): DecodedTrade | null {
  try {
    const ev = decodeEventLog({ abi: TRADE_ABI, data: log.data, topics: log.topics as never });
    const base = {
      curve: getAddress(log.address),
      txHash: log.transactionHash!,
      blockNumber: log.blockNumber!,
      logIndex: log.logIndex!,
      timestamp: logTimestamp(log),
    };
    switch (ev.eventName) {
      case "CurveBuy":
        return { ...base, kind: "buy", trader: getAddress(ev.args.recipient), tokenAmount: ev.args.netTokens, quoteAmount: ev.args.pairCost };
      case "CurveSell":
        return { ...base, kind: "sell", trader: getAddress(ev.args.seller), tokenAmount: ev.args.grossTokens, quoteAmount: ev.args.pairProceeds };
      case "Bought":
        return { ...base, kind: "buy", trader: getAddress(ev.args.recipient), tokenAmount: ev.args.tokenAmount, quoteAmount: ev.args.grossEthUsed };
      case "Sold":
        return { ...base, kind: "sell", trader: getAddress(ev.args.seller), tokenAmount: ev.args.tokenAmount, quoteAmount: ev.args.ethReceived };
    }
  } catch {
    return null;
  }
  return null;
}

export function decodeTransfer(log: Log): DecodedTransfer | null {
  try {
    const { args } = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics as never });
    return {
      token: getAddress(log.address),
      from: getAddress(args.from),
      to: getAddress(args.to),
      value: args.value,
      txHash: log.transactionHash!,
      blockNumber: log.blockNumber!,
      logIndex: log.logIndex!,
      timestamp: logTimestamp(log),
    };
  } catch {
    return null;
  }
}

/** Apply transfers to a balance map. Returns per-(token,wallet) deltas. Pure. */
export function balanceDeltas(transfers: DecodedTransfer[]) {
  const deltas = new Map<string, bigint>();
  const add = (token: string, wallet: string, v: bigint) => {
    if (wallet.toLowerCase() === "0x0000000000000000000000000000000000000000") return; // mint/burn source/sink
    const k = `${token.toLowerCase()}:${wallet.toLowerCase()}`;
    deltas.set(k, (deltas.get(k) ?? 0n) + v);
  };
  for (const t of transfers) {
    if (t.value === 0n || t.from === t.to) continue;
    add(t.token, t.from, -t.value);
    add(t.token, t.to, t.value);
  }
  return deltas;
}

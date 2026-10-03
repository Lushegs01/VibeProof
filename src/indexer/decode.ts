import { decodeEventLog, getAddress, type Log } from "viem";
import { TRANSFER_EVENT } from "../lib/vibe/abis";
import { VibeAdapter, logMeta, logTimestamp } from "../lib/launchpads/vibe";
import type { DecodedGraduation, DecodedLaunch, DecodedTrade, LaunchpadDeployment } from "../lib/launchpads/types";
import { ZERO_ADDRESS } from "../lib/util/address";

/** Pure log → domain decoding. No IO, fully unit-testable. Launchpad-specific decoding lives in adapters. */

export type { DecodedGraduation, DecodedLaunch, DecodedTrade };
export { logTimestamp };

export type DecodedTransfer = {
  token: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  blockHash?: `0x${string}` | null;
  logIndex: number;
  timestamp: Date | null;
  timestampExact?: boolean;
};

const adapters = new Map<string, VibeAdapter>();
function adapterFor(dep: LaunchpadDeployment) {
  const k = `${dep.chainId}:${dep.id}:${dep.factory}`;
  let a = adapters.get(k);
  if (!a) adapters.set(k, (a = new VibeAdapter(dep.chainId, [dep])));
  return a;
}

/** Decode a vibe/vibe factory launch log for a given deployment (null if it is not one). */
export function decodeLaunch(log: Log, dep: LaunchpadDeployment): DecodedLaunch | null {
  return adapterFor(dep).decodeLaunch(log, dep);
}

const curveDecoder = new VibeAdapter(0, []);
export const decodeTrade = (log: Log): DecodedTrade | null => curveDecoder.decodeTrade(log);
export const decodeGraduation = (log: Log): DecodedGraduation | null => curveDecoder.decodeGraduation(log);

export function decodeTransfer(log: Log): DecodedTransfer | null {
  const meta = logMeta(log);
  // ERC-20 Transfer has exactly 3 topics; ERC-721 Transfer (4 topics) shares topic0 and must not decode as a token amount.
  if (!meta || log.topics.length !== 3) return null;
  try {
    const { args } = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics as never, strict: true });
    return { token: getAddress(log.address), from: getAddress(args.from), to: getAddress(args.to), value: args.value, ...meta, timestamp: logTimestamp(log) };
  } catch {
    return null;
  }
}

/**
 * Apply transfers to a balance map. Returns per-(token,wallet) deltas. Pure, exact bigint math.
 * The zero address is the mint source / burn sink and never holds a balance; zero-value and
 * self transfers do not change balances.
 */
export function balanceDeltas(transfers: Pick<DecodedTransfer, "token" | "from" | "to" | "value">[]) {
  const deltas = new Map<string, bigint>();
  const zero = ZERO_ADDRESS.toLowerCase();
  const add = (token: string, wallet: string, v: bigint) => {
    if (wallet.toLowerCase() === zero) return;
    const k = `${token.toLowerCase()}:${wallet.toLowerCase()}`;
    deltas.set(k, (deltas.get(k) ?? 0n) + v);
  };
  for (const t of transfers) {
    if (t.value === 0n || t.from.toLowerCase() === t.to.toLowerCase()) continue;
    add(t.token, t.from, -t.value);
    add(t.token, t.to, t.value);
  }
  return deltas;
}

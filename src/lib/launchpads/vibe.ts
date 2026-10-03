import { decodeEventLog, getAddress, toEventSelector, type AbiEvent, type Log } from "viem";
import { VIBE_EVENTS } from "../vibe/abis";
import { vibeDeployments } from "../vibe/contracts";
import { ZERO_ADDRESS } from "../util/address";
import { displayText, jsonSafe } from "../util/sanitize";
import type { DecodedGraduation, DecodedLaunch, DecodedTrade, LaunchpadAdapter, LaunchpadDeployment } from "./types";

/**
 * vibe/vibe adapter. Pure decoding over configured deployments: no IO.
 *
 *   v5 factory: TokenLaunched (ETH curve) and TokenLaunchedQuoted (curve quoted in `quoteCurrency`)
 *   v6 factory: LaunchCreated (curve quoted in `pairCurrency`, 0x0 = ETH)
 *   v5 curve:   Bought / Sold / CurveCompleted / Graduated(bytes32,uint256,uint256)
 *   v6 curve:   CurveBuy / CurveSell / Graduated(bytes32,uint256,uint256,uint256)
 */
const LAUNCH_EVENTS: Record<string, readonly AbiEvent[]> = {
  v5: [VIBE_EVENTS.TokenLaunched, VIBE_EVENTS.TokenLaunchedQuoted],
  v6: [VIBE_EVENTS.LaunchCreated],
};

const TRADE_EVENTS = [VIBE_EVENTS.CurveBuy, VIBE_EVENTS.CurveSell, VIBE_EVENTS.Bought, VIBE_EVENTS.Sold] as const;
const GRAD_EVENTS = [VIBE_EVENTS.Graduated, VIBE_EVENTS.GraduatedV6, VIBE_EVENTS.CurveCompleted] as const;
export const VIBE_CURVE_EVENTS: readonly AbiEvent[] = [...TRADE_EVENTS, ...GRAD_EVENTS];
const TRADE_TOPICS = new Set<string>(TRADE_EVENTS.map((e) => toEventSelector(e)));
const GRAD_TOPICS = new Set<string>(GRAD_EVENTS.map((e) => toEventSelector(e)));

type LogMeta = { txHash: `0x${string}`; blockNumber: bigint; blockHash: `0x${string}` | null; logIndex: number };

/** Logs without a block number / index (pending) or flagged `removed` (reorged out) are never decoded. */
export function logMeta(log: Log): LogMeta | null {
  if (log.removed) return null;
  if (log.blockNumber === null || log.blockNumber === undefined || log.logIndex === null || log.logIndex === undefined || !log.transactionHash) return null;
  return { txHash: log.transactionHash, blockNumber: log.blockNumber, blockHash: log.blockHash ?? null, logIndex: log.logIndex };
}

export function logTimestamp(log: Log): Date | null {
  const t = (log as unknown as { blockTimestamp?: string | bigint | number }).blockTimestamp;
  if (t === undefined || t === null) return null;
  const n = typeof t === "string" ? Number(BigInt(t)) : Number(t);
  // Robinhood Chain RPCs return 0x0 here: treat that as "unknown", never epoch.
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

export class VibeAdapter implements LaunchpadAdapter {
  readonly id = "vibe";
  readonly label = "vibe/vibe";
  private readonly deps: LaunchpadDeployment[];
  private readonly byFactory: Map<string, LaunchpadDeployment>;

  constructor(
    readonly chainId: number,
    deployments?: LaunchpadDeployment[],
  ) {
    this.deps = (deployments ?? vibeDeployments(chainId)).filter((d) => d.chainId === chainId && d.enabled);
    this.byFactory = new Map(this.deps.map((d) => [d.factory.toLowerCase(), d]));
  }

  deployments() {
    return this.deps;
  }

  isFactory(address: string) {
    return this.byFactory.get(address.toLowerCase()) ?? null;
  }

  getLaunchEvents(dep: LaunchpadDeployment) {
    const ev = LAUNCH_EVENTS[dep.version];
    if (!ev) throw new Error(`vibe/vibe deployment ${dep.id}: unsupported version ${dep.version}`);
    return ev;
  }

  getCurveEvents() {
    return VIBE_CURVE_EVENTS;
  }

  protocolExclusions() {
    return this.deps
      .flatMap((d) => [{ address: d.factory.toLowerCase(), label: `vibe/vibe ${d.id} factory` }, ...Object.entries(d.protocolContracts).map(([k, a]) => ({ address: a.toLowerCase(), label: `vibe/vibe ${d.id} ${k}` }))])
      .filter((x, i, arr) => arr.findIndex((y) => y.address === x.address) === i);
  }

  decodeLaunch(log: Log, dep: LaunchpadDeployment): DecodedLaunch | null {
    const meta = logMeta(log);
    if (!meta) return null;
    // A launch is only accepted from the deployment's own factory.
    if (log.address.toLowerCase() !== dep.factory.toLowerCase()) return null;
    let ev: { eventName: string; args: Record<string, unknown> };
    try {
      ev = decodeEventLog({ abi: this.getLaunchEvents(dep), data: log.data, topics: log.topics as never, strict: true }) as never;
    } catch {
      return null;
    }
    const a = ev.args;
    const base = {
      launchpad: this.id,
      deploymentId: dep.id,
      version: dep.version,
      eventName: ev.eventName,
      factory: getAddress(log.address),
      ...meta,
      timestamp: logTimestamp(log),
      launchId: a.launchId as bigint,
      token: getAddress(a.token as string),
      curve: a.curve ? getAddress(a.curve as string) : null,
      metadataURI: displayText(a.metadataURI as string, 2048) || null,
      raw: jsonSafe(a) as Record<string, unknown>,
    };
    switch (ev.eventName) {
      case "LaunchCreated":
        return { ...base, creator: getAddress(a.launcher as string), pairCurrency: getAddress(a.pairCurrency as string), name: displayText(a.name as string), symbol: displayText(a.symbol as string, 64), metadataDigest: null };
      case "TokenLaunched":
        // v5 curves are ETH-denominated (Bought/Sold carry ETH amounts). Name/symbol come from the token.
        return { ...base, creator: getAddress(a.creator as string), pairCurrency: ZERO_ADDRESS, name: null, symbol: null, metadataDigest: a.metadataDigest as `0x${string}` };
      case "TokenLaunchedQuoted":
        return { ...base, creator: getAddress(a.creator as string), pairCurrency: getAddress(a.quoteCurrency as string), name: null, symbol: null, metadataDigest: a.metadataDigest as `0x${string}` };
    }
    return null;
  }

  decodeTrade(log: Log): DecodedTrade | null {
    const meta = logMeta(log);
    if (!meta || !TRADE_TOPICS.has(log.topics[0] ?? "")) return null;
    try {
      const ev = decodeEventLog({ abi: TRADE_EVENTS, data: log.data, topics: log.topics as never, strict: true });
      const base = { curve: getAddress(log.address), eventName: ev.eventName, ...meta, timestamp: logTimestamp(log) };
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

  decodeGraduation(log: Log): DecodedGraduation | null {
    const meta = logMeta(log);
    if (!meta || !GRAD_TOPICS.has(log.topics[0] ?? "")) return null;
    try {
      const ev = decodeEventLog({ abi: GRAD_EVENTS, data: log.data, topics: log.topics as never, strict: true });
      const base = { curve: getAddress(log.address), eventName: ev.eventName, ...meta, timestamp: logTimestamp(log) };
      if (ev.eventName === "CurveCompleted") return { ...base, kind: "curve_completed", poolId: null, tokenAmount: null, quoteAmount: ev.args.netEthReserve };
      const args = ev.args as { poolId: `0x${string}`; tokenAmount: bigint; ethAmount?: bigint; pairAmount?: bigint };
      return { ...base, kind: "graduated", poolId: args.poolId, tokenAmount: args.tokenAmount, quoteAmount: args.pairAmount ?? args.ethAmount ?? null };
    } catch {
      return null;
    }
  }
}

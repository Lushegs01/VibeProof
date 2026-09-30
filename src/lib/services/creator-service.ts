import { and, desc, eq } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import { cached } from "../cache/cache";
import { getDb, schema } from "../db/client";
import { isDemoMode } from "../demo/mode";
import { DEMO_TOKENS } from "../demo/data";
import type { Evidence } from "../verification/types";

const { creators, launches, tokens } = schema;
const CHAIN_ID = 46630;

export type CreatorLaunch = {
  token: string;
  name: string | null;
  symbol: string | null;
  createdAt: string;
  status: string;
  graduatedAt: string | null;
  holders: number | null;
  transactions: number | null;
  lastActivityAt: string | null;
  deploymentId: string;
  txHash: string;
};

export type CreatorPassport = {
  address: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  launchCount: number;
  graduatedLaunchCount: number;
  activeLaunchCount: number;
  historicalLaunchCount: number;
  launches: CreatorLaunch[];
  evidence: Evidence;
  definitions: Record<string, string>;
  demo: boolean;
};

export const CREATOR_DEFINITIONS = {
  launches: "Tokens whose vibe/vibe launch event names this wallet as launcher/creator.",
  graduated: "Launches for which a graduation event was observed on the bonding curve.",
  active: "Launches still on the bonding curve with any observed Transfer/trade in the last 7 days.",
  historical: "Launches still on the bonding curve with no observed activity in the last 7 days.",
};

async function build(address: Address): Promise<CreatorPassport | null> {
  const db = getDb();
  if (!db) return null;
  const a = address.toLowerCase();
  const c = await db.query.creators.findFirst({ where: and(eq(creators.chainId, CHAIN_ID), eq(creators.address, a)) });
  if (!c) return null;
  const rows = await db
    .select({ l: launches, t: tokens })
    .from(launches)
    .leftJoin(tokens, and(eq(tokens.chainId, launches.chainId), eq(tokens.address, launches.tokenAddress)))
    .where(and(eq(launches.chainId, CHAIN_ID), eq(launches.creatorAddress, a)))
    .orderBy(desc(launches.createdAt))
    .limit(500);
  return {
    address: getAddress(address),
    firstSeenAt: c.firstSeenAt?.toISOString() ?? null,
    lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
    launchCount: c.launchCount,
    graduatedLaunchCount: c.graduatedLaunchCount,
    activeLaunchCount: c.activeLaunchCount,
    historicalLaunchCount: c.historicalLaunchCount,
    launches: rows.map(({ l, t }) => ({
      token: getAddress(l.tokenAddress),
      name: t?.name ?? null,
      symbol: t?.symbol ?? null,
      createdAt: l.createdAt.toISOString(),
      status: l.status,
      graduatedAt: l.graduatedAt?.toISOString() ?? null,
      holders: t?.holderCount ?? null,
      transactions: t?.transferCount ?? null,
      lastActivityAt: t?.lastActivityAt?.toISOString() ?? null,
      deploymentId: l.deploymentId,
      txHash: l.txHash,
    })),
    evidence: { source: "VibeProof indexer (Robinhood Chain Testnet logs)", method: "vibe/vibe factory launch events filtered by launcher", observedAt: new Date().toISOString() },
    definitions: CREATOR_DEFINITIONS,
    demo: false,
  };
}

function demoCreator(address: string): CreatorPassport | null {
  const list = DEMO_TOKENS.filter((t) => t.creator.toLowerCase() === address.toLowerCase());
  if (!list.length) return null;
  const at = (h: number) => new Date(Date.parse("2026-09-27T12:00:00Z") + h * 3600_000).toISOString();
  return {
    address: list[0].creator,
    firstSeenAt: at(list[0].hours),
    lastSeenAt: at(list[list.length - 1].hours),
    launchCount: list.length,
    graduatedLaunchCount: list.filter((t) => t.graduated).length,
    activeLaunchCount: list.filter((t) => !t.graduated).length,
    historicalLaunchCount: 0,
    launches: list.map((t) => ({ token: t.addr, name: t.name, symbol: t.symbol, createdAt: at(t.hours), status: t.graduated ? "graduated" : "bonding", graduatedAt: t.graduated ? at(t.hours + 20) : null, holders: t.holders, transactions: t.txs, lastActivityAt: at(71), deploymentId: "v6-run15", txHash: `0x${"de".repeat(32)}` })),
    evidence: { source: "DEMO DATA", method: "Deterministic fixture", observedAt: at(72) },
    definitions: CREATOR_DEFINITIONS,
    demo: true,
  };
}

export async function getCreatorPassport(address: Address) {
  if (isDemoMode()) return { creator: demoCreator(address), cached: false };
  const { value, cached: hit } = await cached(`creator:v1:${address.toLowerCase()}`, { ttl: 30, swr: 300 }, () => build(address));
  return { creator: value, cached: hit };
}

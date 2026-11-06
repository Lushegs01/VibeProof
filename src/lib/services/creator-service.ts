import { and, desc, eq } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import { cached } from "../cache/cache";
import { getDb, schema } from "../db/client";
import { isDemoMode } from "../demo/mode";
import { DEMO_TOKENS } from "../demo/data";
import type { Evidence } from "../verification/types";
import type { NetworkSlug } from "../chain/networks";
import { creatorTimeline } from "./history-service";
import { serviceNetwork } from "./network";

const { creators, launches, tokens } = schema;

export type CreatorLaunch = {
  chain: string;
  token: string;
  name: string | null;
  symbol: string | null;
  createdAt: string;
  status: string;
  graduatedAt: string | null;
  /** null = unavailable (token history not fully indexed). */
  holders: number | null;
  transactions: number | null;
  lastActivityAt: string | null;
  historyComplete: boolean;
  deploymentId: string;
  txHash: string;
};

export type CreatorPassport = {
  chain: string;
  address: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  launchCount: number;
  graduatedLaunchCount: number;
  activeLaunchCount: number;
  historicalLaunchCount: number;
  launches: CreatorLaunch[];
  timeline?: Awaited<ReturnType<typeof creatorTimeline>>;
  evidence: Evidence;
  definitions: Record<string, string>;
  demo: boolean;
};

export const CREATOR_DEFINITIONS = {
  launches: "Tokens whose vibe/vibe launch event names this wallet as launcher/creator.",
  graduated: "Launches for which a Graduated event was observed on their own bonding curve.",
  active: "Launches not yet graduated with any observed Transfer/trade in the last 7 days.",
  historical:
    "Launches not yet graduated, with complete indexed history and no observed activity in the last 7 days. Launches whose history is still being indexed are in neither group.",
};

async function build(address: Address, chainId: number, slug: string, chainName: string): Promise<CreatorPassport | null> {
  const db = getDb();
  if (!db) return null;
  const a = address.toLowerCase();
  const c = await db.query.creators.findFirst({ where: and(eq(creators.chainId, chainId), eq(creators.address, a)) });
  if (!c) return null;
  const rows = await db
    .select({ l: launches, t: tokens })
    .from(launches)
    .leftJoin(tokens, and(eq(tokens.chainId, launches.chainId), eq(tokens.address, launches.tokenAddress)))
    .where(and(eq(launches.chainId, chainId), eq(launches.creatorAddress, a)))
    .orderBy(desc(launches.createdAt))
    .limit(500);
  return {
    chain: slug,
    address: getAddress(address),
    firstSeenAt: c.firstSeenAt?.toISOString() ?? null,
    lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
    launchCount: c.launchCount,
    graduatedLaunchCount: c.graduatedLaunchCount,
    activeLaunchCount: c.activeLaunchCount,
    historicalLaunchCount: c.historicalLaunchCount,
    timeline: await creatorTimeline(address, chainId),
    launches: rows.map(({ l, t }) => ({
      chain: slug,
      token: getAddress(l.tokenAddress),
      name: t?.name ?? null,
      symbol: t?.symbol ?? null,
      createdAt: l.createdAt.toISOString(),
      status: l.status,
      graduatedAt: l.graduatedAt?.toISOString() ?? null,
      holders: t?.activityCovered ? t.holderCount : null,
      transactions: t?.activityCovered ? t.transferCount : null,
      lastActivityAt: t?.activityCovered ? (t.lastActivityAt?.toISOString() ?? null) : null,
      historyComplete: !!t?.activityCovered,
      deploymentId: l.deploymentId,
      txHash: l.txHash,
    })),
    evidence: {
      source: `VibeProof indexer (${chainName} logs)`,
      method: "Launchpad factory launch events filtered by launcher",
      observedAt: new Date().toISOString(),
    },
    definitions: CREATOR_DEFINITIONS,
    demo: false,
  };
}

function demoCreator(address: string): CreatorPassport | null {
  const list = DEMO_TOKENS.filter((t) => t.creator.toLowerCase() === address.toLowerCase());
  if (!list.length) return null;
  const at = (h: number) => new Date(Date.parse("2026-09-27T12:00:00Z") + h * 3600_000).toISOString();
  return {
    chain: "robinhood-testnet",
    address: list[0].creator,
    firstSeenAt: at(list[0].hours),
    lastSeenAt: at(list[list.length - 1].hours),
    launchCount: list.length,
    graduatedLaunchCount: list.filter((t) => t.graduated).length,
    activeLaunchCount: list.filter((t) => !t.graduated).length,
    historicalLaunchCount: 0,
    launches: list.map((t) => ({
      chain: "robinhood-testnet",
      historyComplete: true,
      token: t.addr,
      name: t.name,
      symbol: t.symbol,
      createdAt: at(t.hours),
      status: t.graduated ? "graduated" : "bonding",
      graduatedAt: t.graduated ? at(t.hours + 20) : null,
      holders: t.holders,
      transactions: t.txs,
      lastActivityAt: at(71),
      deploymentId: "v6-run15",
      txHash: `0x${"de".repeat(32)}`,
    })),
    evidence: { source: "DEMO DATA", method: "Deterministic fixture", observedAt: at(72) },
    definitions: CREATOR_DEFINITIONS,
    demo: true,
  };
}

export async function getCreatorPassport(address: Address, network?: NetworkSlug | string | null) {
  if (isDemoMode()) return { creator: demoCreator(address), cached: false };
  const net = serviceNetwork(network);
  const { value, cached: hit } = await cached(`creator:v2:${net.chainId}:${address.toLowerCase()}`, { ttl: 30, swr: 300 }, () =>
    build(address, net.chainId, net.slug, net.name),
  );
  return { creator: value, cached: hit };
}

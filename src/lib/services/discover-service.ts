import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { getAddress } from "viem";
import { cached } from "../cache/cache";
import { getDb, schema } from "../db/client";
import { isDemoMode } from "../demo/mode";
import { DEMO_TOKENS } from "../demo/data";

const { tokens, launches, projectProofs, feedEvents } = schema;
const CHAIN_ID = 46630;

export const SORTS = {
  newest: { label: "Newest", explain: "Launch block timestamp, most recent first." },
  transactions: { label: "Most transactions", explain: "Count of ERC-20 Transfer events observed since launch." },
  holders: { label: "Most holders", explain: "Wallets with a positive balance, excluding zero/dead and the curve contract." },
  active: { label: "Most recently active", explain: "Timestamp of the latest observed Transfer or curve trade." },
  verified: { label: "Most recently verified", explain: "Most recent project proof submission." },
  graduated: { label: "Recently graduated", explain: "Graduation event timestamp (only launches with an observed graduation)." },
} as const;
export type SortKey = keyof typeof SORTS;

export const CATEGORIES = {
  all: "All launches",
  "product-backed": "Product-backed (proof submitted)",
  graduated: "Graduated",
  "source-verified": "Source verified on explorer",
} as const;
export type CategoryKey = keyof typeof CATEGORIES;

export type DiscoverItem = {
  address: string;
  name: string | null;
  symbol: string | null;
  creator: string | null;
  createdAt: string | null;
  holders: number | null;
  transactions: number | null;
  lastActivityAt: string | null;
  status: string | null;
  proofSubmitted: boolean;
  sourceVerified: boolean | null;
};

async function build(sort: SortKey, category: CategoryKey, limit: number): Promise<DiscoverItem[]> {
  const db = getDb();
  if (!db) return [];
  const where: SQL[] = [eq(tokens.chainId, CHAIN_ID), eq(tokens.isVibeLaunch, true)];
  if (category === "product-backed" || sort === "verified") where.push(isNotNull(projectProofs.id));
  if (category === "graduated" || sort === "graduated") where.push(eq(launches.status, "graduated"));
  if (category === "source-verified") where.push(eq(tokens.verifiedContract, true));
  const order = {
    newest: [desc(tokens.createdAt)],
    transactions: [sql`${tokens.transferCount} desc nulls last`],
    holders: [sql`${tokens.holderCount} desc nulls last`],
    active: [sql`${tokens.lastActivityAt} desc nulls last`],
    verified: [desc(projectProofs.updatedAt)],
    graduated: [sql`${launches.graduatedAt} desc nulls last`],
  }[sort];
  const rows = await db
    .select({ t: tokens, l: launches, p: projectProofs })
    .from(tokens)
    .leftJoin(launches, and(eq(launches.chainId, tokens.chainId), eq(launches.tokenAddress, tokens.address)))
    .leftJoin(projectProofs, and(eq(projectProofs.chainId, tokens.chainId), eq(projectProofs.tokenAddress, tokens.address)))
    .where(and(...where))
    .orderBy(...order)
    .limit(limit);
  return rows.map(({ t, l, p }) => ({
    address: getAddress(t.address),
    name: t.name,
    symbol: t.symbol,
    creator: t.creatorAddress ? getAddress(t.creatorAddress) : null,
    createdAt: t.createdAt?.toISOString() ?? null,
    holders: t.holderCount,
    transactions: t.transferCount,
    lastActivityAt: t.lastActivityAt?.toISOString() ?? null,
    status: l?.status ?? null,
    proofSubmitted: !!p,
    sourceVerified: t.verifiedContract,
  }));
}

export async function discover(sort: SortKey = "newest", category: CategoryKey = "all", limit = 50) {
  if (isDemoMode()) {
    const at = (h: number) => new Date(Date.parse("2026-09-27T12:00:00Z") + h * 3600_000).toISOString();
    let items: DiscoverItem[] = DEMO_TOKENS.map((t) => ({ address: t.addr, name: t.name, symbol: t.symbol, creator: t.creator, createdAt: at(t.hours), holders: t.holders, transactions: t.txs, lastActivityAt: at(71 - t.hours / 10), status: t.graduated ? "graduated" : "bonding", proofSubmitted: t.proof > 0, sourceVerified: t.verified }));
    if (category === "product-backed") items = items.filter((i) => i.proofSubmitted);
    if (category === "graduated") items = items.filter((i) => i.status === "graduated");
    if (category === "source-verified") items = items.filter((i) => i.sourceVerified);
    const key: Record<SortKey, (i: DiscoverItem) => number> = { newest: (i) => +new Date(i.createdAt!), transactions: (i) => i.transactions ?? -1, holders: (i) => i.holders ?? -1, active: (i) => +new Date(i.lastActivityAt!), verified: (i) => (i.proofSubmitted ? 1 : 0), graduated: (i) => (i.status === "graduated" ? 1 : 0) };
    return { items: items.sort((a, b) => key[sort](b) - key[sort](a)), cached: false };
  }
  const { value, cached: hit } = await cached(`discover:v1:${sort}:${category}:${limit}`, { ttl: 15, swr: 120 }, () => build(sort, category, limit));
  return { items: value, cached: hit };
}

export type FeedItem = { id: number; kind: string; message: string; token: string; symbol: string | null; txHash: string | null; at: string };

export async function activityFeed(limit = 60): Promise<FeedItem[]> {
  if (isDemoMode()) {
    const at = (h: number) => new Date(Date.parse("2026-09-27T12:00:00Z") + h * 3600_000).toISOString();
    return [
      { id: 4, kind: "holders", message: "42 new holders observed", token: DEMO_TOKENS[0].addr, symbol: "LATTICE", txHash: null, at: at(71.8) },
      { id: 3, kind: "creator_activity", message: "Creator wallet bought on the bonding curve", token: DEMO_TOKENS[1].addr, symbol: "QLDG", txHash: `0x${"cd".repeat(32)}`, at: at(71.2) },
      { id: 2, kind: "proof", message: "Project proof submitted (3 links)", token: DEMO_TOKENS[0].addr, symbol: "LATTICE", txHash: null, at: at(70.4) },
      { id: 1, kind: "launch", message: "Launched via vibe/vibe v6-run15 factory", token: DEMO_TOKENS[3].addr, symbol: "NWIND", txHash: `0x${"de".repeat(32)}`, at: at(64) },
    ];
  }
  const db = getDb();
  if (!db) return [];
  const { value } = await cached(`feed:v1:${limit}`, { ttl: 5, swr: 30 }, async () => {
    const rows = await db
      .select({ f: feedEvents, symbol: tokens.symbol })
      .from(feedEvents)
      .leftJoin(tokens, and(eq(tokens.chainId, feedEvents.chainId), eq(tokens.address, feedEvents.tokenAddress)))
      .orderBy(desc(feedEvents.createdAt))
      .limit(limit);
    return rows.map(({ f, symbol }) => ({ id: f.id, kind: f.kind, message: f.message, token: getAddress(f.tokenAddress), symbol, txHash: f.txHash, at: f.createdAt.toISOString() }));
  });
  return value;
}

export type EcosystemStats = { launches: number; creators: number; covered: number; graduated: number; indexedThrough: string | null; demo: boolean };

/** Real counts for the landing page. null when there is no database (never fabricated). */
export async function ecosystemStats(): Promise<EcosystemStats | null> {
  if (isDemoMode()) return { launches: DEMO_TOKENS.length, creators: 2, covered: DEMO_TOKENS.length, graduated: DEMO_TOKENS.filter((t) => t.graduated).length, indexedThrough: "126600000", demo: true };
  const db = getDb();
  if (!db) return null;
  const { value } = await cached("stats:v1", { ttl: 60, swr: 600 }, async () => {
    const [r] = await db.execute<{ launches: string; creators: string; covered: string; graduated: string; cursor: string | null }>(sql`
      select (select count(*) from launches where chain_id = ${CHAIN_ID}) as launches,
             (select count(*) from creators where chain_id = ${CHAIN_ID}) as creators,
             (select count(*) from tokens where chain_id = ${CHAIN_ID} and activity_covered) as covered,
             (select count(*) from launches where chain_id = ${CHAIN_ID} and status = 'graduated') as graduated,
             (select last_block::text from indexer_state where key = ${`activity:${CHAIN_ID}`}) as cursor`);
    return { launches: Number(r.launches), creators: Number(r.creators), covered: Number(r.covered), graduated: Number(r.graduated), indexedThrough: r.cursor, demo: false };
  });
  return value;
}

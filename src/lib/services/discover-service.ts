import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { getAddress } from "viem";
import { cached } from "../cache/cache";
import { getDb, schema } from "../db/client";
import { isDemoMode } from "../demo/mode";
import { DEMO_TOKENS } from "../demo/data";
import type { NetworkSlug } from "../chain/networks";
import { serviceNetwork } from "./network";

const { tokens, launches, projectProofs } = schema;

export const SORTS = {
  newest: { label: "Newest", explain: "Launch block timestamp, most recent first.", needsHistory: false },
  transactions: {
    label: "Most transactions",
    explain: "Count of ERC-20 Transfer events observed since launch. Only launches whose complete history is indexed are ranked.",
    needsHistory: true,
  },
  holders: {
    label: "Most holders",
    explain:
      "Wallets with a positive balance, excluding zero/dead, the token itself, the curve and protocol contracts. Only launches whose complete history is indexed are ranked.",
    needsHistory: true,
  },
  active: {
    label: "Most recently active",
    explain: "Timestamp of the latest observed Transfer or curve trade. Only launches whose complete history is indexed are ranked.",
    needsHistory: true,
  },
  verified: { label: "Latest proof submissions", explain: "Most recent project proof submission.", needsHistory: false },
  graduated: {
    label: "Recently graduated",
    explain: "Graduation event timestamp (only launches with an observed Graduated event on their own curve).",
    needsHistory: false,
  },
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
  chain: string;
  address: string;
  name: string | null;
  symbol: string | null;
  creator: string | null;
  createdAt: string | null;
  /** null = unavailable (history not fully indexed), never "zero". */
  holders: number | null;
  transactions: number | null;
  lastActivityAt: string | null;
  status: string | null;
  /** true when every event since launch is indexed (counters are meaningful). */
  historyComplete: boolean;
  launchpad: string | null;
  deploymentId: string | null;
  proofSubmitted: boolean;
  sourceVerified: boolean | null;
};

export type DiscoverResult = { items: DiscoverItem[]; cached: boolean; excludedIncomplete: number | null };

async function build(sort: SortKey, category: CategoryKey, limit: number, chainId: number, slug: string): Promise<Omit<DiscoverResult, "cached">> {
  const db = getDb();
  if (!db) return { items: [], excludedIncomplete: null };
  const where: SQL[] = [eq(tokens.chainId, chainId), eq(tokens.isVibeLaunch, true)];
  if (category === "product-backed" || sort === "verified") where.push(isNotNull(projectProofs.id));
  if (category === "graduated" || sort === "graduated") where.push(eq(launches.status, "graduated"));
  if (category === "source-verified") where.push(eq(tokens.verifiedContract, true));
  // Never rank an unknown value as if it were zero: counter sorts only consider complete histories.
  if (SORTS[sort].needsHistory) where.push(eq(tokens.activityCovered, true));
  const order = {
    newest: [sql`${tokens.createdAt} desc nulls last`],
    transactions: [sql`${tokens.transferCount} desc nulls last`, desc(tokens.createdAt)],
    holders: [sql`${tokens.holderCount} desc nulls last`, desc(tokens.createdAt)],
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
  let excludedIncomplete: number | null = null;
  if (SORTS[sort].needsHistory) {
    const [r] = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from tokens where chain_id = ${chainId} and is_vibe_launch and not activity_covered`,
    );
    excludedIncomplete = Number(r?.n ?? 0);
  }
  return {
    excludedIncomplete,
    items: rows.map(({ t, l, p }) => ({
      chain: slug,
      address: getAddress(t.address),
      name: t.name,
      symbol: t.symbol,
      creator: t.creatorAddress ? getAddress(t.creatorAddress) : null,
      createdAt: t.createdAt?.toISOString() ?? null,
      holders: t.activityCovered ? t.holderCount : null,
      transactions: t.activityCovered ? t.transferCount : null,
      lastActivityAt: t.activityCovered ? (t.lastActivityAt?.toISOString() ?? null) : null,
      status: l?.status ?? null,
      historyComplete: t.activityCovered,
      launchpad: l?.launchpad ?? t.launchpad,
      deploymentId: l?.deploymentId ?? null,
      proofSubmitted: !!p,
      sourceVerified: t.verifiedContract,
    })),
  };
}

export async function discover(
  sort: SortKey = "newest",
  category: CategoryKey = "all",
  limit = 50,
  network?: NetworkSlug | string | null,
): Promise<DiscoverResult> {
  if (isDemoMode()) {
    const at = (h: number) => new Date(Date.parse("2026-09-27T12:00:00Z") + h * 3600_000).toISOString();
    let items: DiscoverItem[] = DEMO_TOKENS.map((t) => ({
      chain: "robinhood-testnet",
      address: t.addr,
      name: t.name,
      symbol: t.symbol,
      creator: t.creator,
      createdAt: at(t.hours),
      holders: t.holders,
      transactions: t.txs,
      lastActivityAt: at(71 - t.hours / 10),
      status: t.graduated ? "graduated" : "bonding",
      historyComplete: true,
      launchpad: "vibe",
      deploymentId: "v6-run15",
      proofSubmitted: t.proof > 0,
      sourceVerified: t.verified,
    }));
    if (category === "product-backed") items = items.filter((i) => i.proofSubmitted);
    if (category === "graduated") items = items.filter((i) => i.status === "graduated");
    if (category === "source-verified") items = items.filter((i) => i.sourceVerified);
    const key: Record<SortKey, (i: DiscoverItem) => number> = {
      newest: (i) => +new Date(i.createdAt!),
      transactions: (i) => i.transactions ?? -1,
      holders: (i) => i.holders ?? -1,
      active: (i) => +new Date(i.lastActivityAt!),
      verified: (i) => (i.proofSubmitted ? 1 : 0),
      graduated: (i) => (i.status === "graduated" ? 1 : 0),
    };
    return { items: items.sort((a, b) => key[sort](b) - key[sort](a)), cached: false, excludedIncomplete: SORTS[sort].needsHistory ? 0 : null };
  }
  const net = serviceNetwork(network);
  const { value, cached: hit } = await cached(`discover:v2:${net.chainId}:${sort}:${category}:${limit}`, { ttl: 15, swr: 120 }, () =>
    build(sort, category, limit, net.chainId, net.slug),
  );
  return { ...value, cached: hit };
}

export type FeedItem = {
  id: string;
  chain: string;
  kind: string;
  message: string;
  token: string;
  symbol: string | null;
  txHash: string | null;
  block: string | null;
  at: string;
  data?: Record<string, unknown> | null;
};

/**
 * Ecosystem feed: derived feed rows (launches, creator activity, graduations, proofs) merged with
 * curve trades read straight from transaction_events. Trades are not copied into feed_events, so
 * nothing can be duplicated; every row links to a real token and transaction.
 */
export async function activityFeed(limit = 60, network?: NetworkSlug | string | null): Promise<FeedItem[]> {
  if (isDemoMode()) {
    const at = (h: number) => new Date(Date.parse("2026-09-27T12:00:00Z") + h * 3600_000).toISOString();
    const d = (id: string, kind: string, message: string, i: number, sym: string, tx: string | null, h: number): FeedItem => ({
      id,
      chain: "robinhood-testnet",
      kind,
      message,
      token: DEMO_TOKENS[i].addr,
      symbol: sym,
      txHash: tx,
      block: null,
      at: at(h),
    });
    return [
      d("d4", "holders", "42 new holders observed", 0, "LATTICE", null, 71.8),
      d("d3", "creator_activity", "Creator wallet bought on the bonding curve", 1, "QLDG", `0x${"cd".repeat(32)}`, 71.2),
      d("d2", "proof", "Project proof submitted (3 links)", 0, "LATTICE", null, 70.4),
      d("d1", "launch", "Launched via vibe/vibe v6-run15 factory", 3, "NWIND", `0x${"de".repeat(32)}`, 64),
    ];
  }
  const db = getDb();
  if (!db) return [];
  const net = serviceNetwork(network);
  const n = Math.max(1, Math.min(200, limit));
  const { value } = await cached(`feed:v2:${net.chainId}:${n}`, { ttl: 5, swr: 30 }, async () => {
    const rows = await db.execute<{
      id: string;
      kind: string;
      message: string;
      token_address: string;
      tx_hash: string | null;
      block: string | null;
      at: Date;
      data: Record<string, unknown> | null;
      symbol: string | null;
    }>(sql`
      with f as (
        (select 'f' || id as id, kind, message, token_address, tx_hash, block_number::text as block, created_at as at, data
           from feed_events where chain_id = ${net.chainId} order by created_at desc limit ${n})
        union all
        (select 't' || id, event_type,
                case when event_type = 'buy' then 'Bought on the bonding curve' else 'Sold on the bonding curve' end,
                token_address, tx_hash, block_number::text, timestamp,
                jsonb_build_object('wallet', wallet_address, 'amount', amount::text, 'quote', quote_amount::text, 'event', event_name)
           from transaction_events where chain_id = ${net.chainId} and event_type in ('buy', 'sell') order by timestamp desc limit ${n})
      )
      select f.*, t.symbol from f left join tokens t on t.chain_id = ${net.chainId} and t.address = f.token_address
      order by f.at desc limit ${n}`);
    return [...rows].map((r) => ({
      id: r.id,
      chain: net.slug,
      kind: r.kind,
      message: r.message,
      token: getAddress(r.token_address),
      symbol: r.symbol,
      txHash: r.tx_hash,
      block: r.block,
      at: new Date(r.at).toISOString(),
      data: r.data,
    }));
  });
  return value;
}

export type EcosystemStats = {
  network: string;
  launches: number;
  creators: number;
  covered: number;
  graduated: number;
  pendingHistory: number;
  indexedThrough: string | null;
  demo: boolean;
};

/** Real counts for the landing page. null when there is no database (never fabricated). */
export async function ecosystemStats(network?: NetworkSlug | string | null): Promise<EcosystemStats | null> {
  if (isDemoMode())
    return {
      network: "robinhood-testnet",
      launches: DEMO_TOKENS.length,
      creators: 2,
      covered: DEMO_TOKENS.length,
      graduated: DEMO_TOKENS.filter((t) => t.graduated).length,
      pendingHistory: 0,
      indexedThrough: "126600000",
      demo: true,
    };
  const db = getDb();
  if (!db) return null;
  const net = serviceNetwork(network);
  const c = net.chainId;
  const { value } = await cached(`stats:v2:${c}`, { ttl: 60, swr: 600 }, async () => {
    const [r] = await db.execute<{ launches: string; creators: string; covered: string; graduated: string; pending: string; cursor: string | null }>(sql`
      select (select count(*) from launches where chain_id = ${c}) as launches,
             (select count(*) from creators where chain_id = ${c}) as creators,
             (select count(*) from tokens where chain_id = ${c} and activity_covered) as covered,
             (select count(*) from launches where chain_id = ${c} and status = 'graduated') as graduated,
             (select count(*) from backfill_queue where chain_id = ${c} and status in ('pending', 'started', 'failed')) as pending,
             (select last_block::text from indexer_state where key = ${`activity:${c}`}) as cursor`);
    return {
      network: net.slug,
      launches: Number(r.launches),
      creators: Number(r.creators),
      covered: Number(r.covered),
      graduated: Number(r.graduated),
      pendingHistory: Number(r.pending),
      indexedThrough: r.cursor,
      demo: false,
    };
  });
  return value;
}

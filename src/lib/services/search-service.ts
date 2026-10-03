import { and, desc, eq, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { getProvider } from "../chain/provider";
import { explorerLink, tokenPath, type NetworkSlug } from "../chain/networks";
import { getDb, schema } from "../db/client";
import { isDemoMode } from "../demo/mode";
import { DEMO_CREATORS, DEMO_TOKENS } from "../demo/data";
import { isTxHash, parseAddress } from "../util/address";
import { serviceNetwork } from "./network";

const { tokens, creators, transactionEvents, launches } = schema;

export type SearchResult =
  | { kind: "token"; address: string; name: string | null; symbol: string | null; isVibeLaunch: boolean; href: string }
  | { kind: "creator"; address: string; launchCount: number; href: string }
  | { kind: "wallet"; address: string; href: string }
  | { kind: "transaction"; hash: string; token: string | null; href: string };

export type QueryKind = "address" | "tx" | "symbol" | "text" | "empty";

/** Classify raw input without IO. */
export function classifyQuery(q: string): QueryKind {
  const s = q.trim();
  if (!s) return "empty";
  if (isTxHash(s)) return "tx";
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return "address";
  if (/^\$[A-Za-z0-9]{1,20}$/.test(s)) return "symbol";
  return "text";
}

/** LIKE pattern from user input: wildcards escaped, length capped. */
export function likeSafe(term: string) {
  return term.replace(/[%_\\]/g, (m) => `\\${m}`).slice(0, 40);
}

/**
 * Search indexed data of ONE network (never demo fixtures unless demo mode is on).
 * Supports contract address, $SYMBOL, symbol/name text, creator wallet and transaction hash.
 */
export async function search(q: string, network?: NetworkSlug | string | null): Promise<SearchResult[]> {
  const kind = classifyQuery(q);
  const s = q.trim();
  if (kind === "empty") return [];
  if (isDemoMode()) return demoSearch(s, kind);
  const net = serviceNetwork(network);
  const c = net.chainId;
  const href = (a: string) => tokenPath(getAddress(a), net.slug);
  const db = getDb();

  if (kind === "tx") {
    const hash = s.toLowerCase();
    const ev = db ? await db.query.transactionEvents.findFirst({ where: and(eq(transactionEvents.chainId, c), eq(transactionEvents.txHash, hash)) }) : undefined;
    const launch = db && !ev ? await db.query.launches.findFirst({ where: and(eq(launches.chainId, c), eq(launches.txHash, hash)) }) : undefined;
    const token = ev?.tokenAddress ?? launch?.tokenAddress ?? null;
    if (token) return [{ kind: "transaction", hash, token: getAddress(token), href: href(token) }];
    const tx = await getProvider(net.slug).getTransaction(s as `0x${string}`);
    return tx ? [{ kind: "transaction", hash, token: null, href: explorerLink("tx", hash, net.slug) }] : [];
  }

  if (kind === "address") {
    const addr = parseAddress(s) ?? (getAddress(s.toLowerCase()) as `0x${string}`);
    const a = addr.toLowerCase();
    const out: SearchResult[] = [];
    if (db) {
      const [t, cr] = await Promise.all([
        db.query.tokens.findFirst({ where: and(eq(tokens.chainId, c), eq(tokens.address, a)) }),
        db.query.creators.findFirst({ where: and(eq(creators.chainId, c), eq(creators.address, a)) }),
      ]);
      if (t) out.push({ kind: "token", address: addr, name: t.name, symbol: t.symbol, isVibeLaunch: t.isVibeLaunch, href: href(a) });
      if (cr) out.push({ kind: "creator", address: addr, launchCount: cr.launchCount, href: `/creator/${addr}` });
    }
    if (!out.length) {
      const code = await getProvider(net.slug).getBytecode(addr);
      out.push(code && code !== "0x" ? { kind: "token", address: addr, name: null, symbol: null, isVibeLaunch: false, href: href(a) } : { kind: "wallet", address: addr, href: `/creator/${addr}` });
    }
    return out;
  }

  if (!db) return [];
  const term = (kind === "symbol" ? s.slice(1) : s).toLowerCase();
  const safe = likeSafe(term);
  // lower(...) LIKE 'x%' uses the (chain_id, lower(col) text_pattern_ops) indexes; name substring
  // matches fall back to a scan bounded by chain_id and LIMIT.
  const match = kind === "symbol" ? sql`lower(${tokens.symbol}) = ${term.slice(0, 40)}` : sql`(lower(${tokens.symbol}) like ${`${safe}%`} or lower(${tokens.name}) like ${`${safe}%`} or lower(${tokens.name}) like ${`%${safe}%`})`;
  const rows = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.chainId, c), match))
    .orderBy(sql`lower(${tokens.symbol}) = ${term} desc`, sql`${tokens.isVibeLaunch} desc`, sql`${tokens.holderCount} desc nulls last`, desc(tokens.createdAt))
    .limit(12);
  return rows.map((t) => ({ kind: "token" as const, address: getAddress(t.address), name: t.name, symbol: t.symbol, isVibeLaunch: t.isVibeLaunch, href: href(t.address) }));
}

function demoSearch(s: string, kind: QueryKind): SearchResult[] {
  const l = s.toLowerCase().replace(/^\$/, "");
  const toks = DEMO_TOKENS.filter((t) => t.addr.toLowerCase() === l || t.symbol.toLowerCase().startsWith(l) || t.name.toLowerCase().includes(l));
  const out: SearchResult[] = toks.map((t) => ({ kind: "token", address: t.addr, name: t.name, symbol: t.symbol, isVibeLaunch: true, href: `/token/robinhood-testnet/${t.addr}` }));
  if (kind === "address") {
    const c = DEMO_CREATORS.find((x) => x.toLowerCase() === l);
    if (c) out.push({ kind: "creator", address: c, launchCount: DEMO_TOKENS.filter((t) => t.creator === c).length, href: `/creator/${c}` });
  }
  return out;
}

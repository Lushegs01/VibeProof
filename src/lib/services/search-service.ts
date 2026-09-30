import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { getProvider } from "../chain/provider";
import { getDb, schema } from "../db/client";
import { isDemoMode } from "../demo/mode";
import { DEMO_CREATORS, DEMO_TOKENS } from "../demo/data";
import { isTxHash, parseAddress } from "../util/address";

const { tokens, creators, transactionEvents, launches } = schema;
const CHAIN_ID = 46630;

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

const tokenHref = (a: string) => `/token/robinhood-testnet/${getAddress(a)}`;

export async function search(q: string): Promise<SearchResult[]> {
  const kind = classifyQuery(q);
  const s = q.trim();
  if (kind === "empty") return [];
  if (isDemoMode()) return demoSearch(s, kind);
  const db = getDb();

  if (kind === "tx") {
    const hash = s.toLowerCase();
    const ev = db ? await db.query.transactionEvents.findFirst({ where: eq(transactionEvents.txHash, hash) }) : undefined;
    const launch = db && !ev ? await db.query.launches.findFirst({ where: eq(launches.txHash, hash) }) : undefined;
    const token = ev?.tokenAddress ?? launch?.tokenAddress ?? null;
    if (token) return [{ kind: "transaction", hash, token: getAddress(token), href: tokenHref(token) }];
    const tx = await getProvider().getTransaction(s as `0x${string}`);
    return tx ? [{ kind: "transaction", hash, token: null, href: `https://explorer.testnet.chain.robinhood.com/tx/${hash}` }] : [];
  }

  if (kind === "address") {
    const addr = parseAddress(s) ?? (getAddress(s.toLowerCase()) as `0x${string}`);
    const a = addr.toLowerCase();
    const out: SearchResult[] = [];
    if (db) {
      const [t, c] = await Promise.all([
        db.query.tokens.findFirst({ where: and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, a)) }),
        db.query.creators.findFirst({ where: and(eq(creators.chainId, CHAIN_ID), eq(creators.address, a)) }),
      ]);
      if (t) out.push({ kind: "token", address: addr, name: t.name, symbol: t.symbol, isVibeLaunch: t.isVibeLaunch, href: tokenHref(a) });
      if (c) out.push({ kind: "creator", address: addr, launchCount: c.launchCount, href: `/creator/${addr}` });
    }
    if (!out.length) {
      const code = await getProvider().getBytecode(addr);
      out.push(code && code !== "0x" ? { kind: "token", address: addr, name: null, symbol: null, isVibeLaunch: false, href: tokenHref(a) } : { kind: "wallet", address: addr, href: `/creator/${addr}` });
    }
    return out;
  }

  if (!db) return [];
  const term = kind === "symbol" ? s.slice(1) : s;
  const safe = term.replace(/[%_\\]/g, (m) => `\\${m}`).slice(0, 40);
  const rows = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.chainId, CHAIN_ID), kind === "symbol" ? ilike(tokens.symbol, safe) : or(ilike(tokens.symbol, `${safe}%`), ilike(tokens.name, `%${safe}%`))))
    .orderBy(sql`${tokens.symbol} ilike ${safe} desc`, desc(tokens.holderCount), desc(tokens.createdAt))
    .limit(12);
  return rows.map((t) => ({ kind: "token" as const, address: getAddress(t.address), name: t.name, symbol: t.symbol, isVibeLaunch: t.isVibeLaunch, href: tokenHref(t.address) }));
}

function demoSearch(s: string, kind: QueryKind): SearchResult[] {
  const l = s.toLowerCase().replace(/^\$/, "");
  const toks = DEMO_TOKENS.filter((t) => t.addr.toLowerCase() === l || t.symbol.toLowerCase().startsWith(l) || t.name.toLowerCase().includes(l));
  const out: SearchResult[] = toks.map((t) => ({ kind: "token", address: t.addr, name: t.name, symbol: t.symbol, isVibeLaunch: true, href: tokenHref(t.addr) }));
  if (kind === "address") {
    const c = DEMO_CREATORS.find((x) => x.toLowerCase() === l);
    if (c) out.push({ kind: "creator", address: c, launchCount: DEMO_TOKENS.filter((t) => t.creator === c).length, href: `/creator/${c}` });
  }
  return out;
}

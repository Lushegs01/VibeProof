import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import { isDemoMode } from "../demo/mode";
import { DEMO_TOKENS } from "../demo/data";

import { serviceNetwork } from "./network";

const { shareLinks } = schema;
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

export function newShortId(len = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function getOrCreateShareId(token: string, network?: string | null): Promise<string | null> {
  if (isDemoMode()) {
    const i = DEMO_TOKENS.findIndex((t) => t.addr.toLowerCase() === token.toLowerCase());
    return i >= 0 ? `demo${i + 1}` : null;
  }
  const db = getDb();
  if (!db) return null;
  const CHAIN_ID = serviceNetwork(network).chainId;
  const a = token.toLowerCase();
  const existing = await db.query.shareLinks.findFirst({ where: and(eq(shareLinks.chainId, CHAIN_ID), eq(shareLinks.tokenAddress, a)) });
  if (existing) return existing.id;
  const id = newShortId();
  const [row] = await db.insert(shareLinks).values({ id, chainId: CHAIN_ID, tokenAddress: a }).onConflictDoNothing().returning();
  if (row) return row.id;
  return (await db.query.shareLinks.findFirst({ where: and(eq(shareLinks.chainId, CHAIN_ID), eq(shareLinks.tokenAddress, a)) }))?.id ?? null;
}

export async function resolveShareId(id: string): Promise<{ address: string; chainId: number } | null> {
  if (!/^[A-Za-z0-9]{4,16}$/.test(id)) return null;
  if (isDemoMode()) {
    const m = id.match(/^demo(\d)$/);
    const addr = m ? DEMO_TOKENS[Number(m[1]) - 1]?.addr ?? null : null;
    return addr ? { address: addr, chainId: 46630 } : null;
  }
  const db = getDb();
  if (!db) return null;
  const row = await db.query.shareLinks.findFirst({ where: eq(shareLinks.id, id) });
  return row ? { address: row.tokenAddress, chainId: row.chainId } : null;
}

import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import { accountEntitlements, lockAccount } from "../billing/entitlements";
import type { DB } from "../db/client";
import { ProofError } from "./proof-service";
export async function listWatched(wallet: string) {
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Watchlist storage unavailable.");
  return db.select().from(schema.walletWatchlist).where(eq(schema.walletWatchlist.wallet, wallet)).orderBy(desc(schema.walletWatchlist.createdAt)).limit(10000);
}
export async function updateWatched(wallet: string, chainId: number, tokenAddress: string, action: "add" | "remove" | "checked") {
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Watchlist storage unavailable.");
  const condition = and(
    eq(schema.walletWatchlist.wallet, wallet),
    eq(schema.walletWatchlist.chainId, chainId),
    eq(schema.walletWatchlist.tokenAddress, tokenAddress),
  );
  await db.transaction(async (tx) => {
    await lockAccount(tx as unknown as DB, wallet);
    if (action === "remove") {
      await tx.delete(schema.walletWatchlist).where(condition);
      return;
    }
    if (action === "checked") {
      await tx.update(schema.walletWatchlist).set({ lastCheckedAt: new Date() }).where(condition);
      return;
    }
    const existing = await tx.select().from(schema.walletWatchlist).where(condition);
    if (existing.length) return;
    const account = await accountEntitlements(wallet, tx as unknown as DB);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.walletWatchlist)
      .where(eq(schema.walletWatchlist.wallet, wallet));
    if (count >= account.limits.watchlist) throw new ProofError(409, "watchlist_quota", "Watchlist capacity reached for this plan.");
    await tx.insert(schema.walletWatchlist).values({ wallet, chainId, tokenAddress }).onConflictDoNothing();
  });
}
export const SIGNIFICANT_KINDS = [
  "proof",
  "control_verified",
  "control_expired",
  "control_revoked",
  "implementation_changed",
  "owner_changed",
  "admin_changed",
  "graduation",
  "curve_completed",
] as const;
export async function watchNotifications(wallet: string, offset = 0, limit = 50) {
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Notification storage unavailable.");
  return db
    .select({
      id: schema.feedEvents.id,
      chainId: schema.feedEvents.chainId,
      token: schema.feedEvents.tokenAddress,
      kind: schema.feedEvents.kind,
      message: schema.feedEvents.message,
      txHash: schema.feedEvents.txHash,
      observedAt: schema.feedEvents.createdAt,
      evidence: schema.feedEvents.data,
    })
    .from(schema.feedEvents)
    .innerJoin(
      schema.walletWatchlist,
      and(
        eq(schema.walletWatchlist.wallet, wallet),
        eq(schema.walletWatchlist.chainId, schema.feedEvents.chainId),
        eq(schema.walletWatchlist.tokenAddress, schema.feedEvents.tokenAddress),
        gt(schema.feedEvents.createdAt, schema.walletWatchlist.lastCheckedAt),
      ),
    )
    .where(inArray(schema.feedEvents.kind, [...SIGNIFICANT_KINDS]))
    .orderBy(desc(schema.feedEvents.createdAt), desc(schema.feedEvents.id))
    .limit(limit)
    .offset(offset);
}

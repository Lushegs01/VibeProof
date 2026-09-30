import { and, asc, eq, gte } from "drizzle-orm";
import type { Address } from "viem";
import { getDb, schema } from "../db/client";
import { baselineFor, diffSnapshots } from "../changes/diff";
import { isDemoMode } from "../demo/mode";
import { demoChanges } from "../demo/data";
import type { ChangesResponse } from "./types";

const { activitySnapshots, tokens, feedEvents, verificationChecks } = schema;
const CHAIN_ID = 46630;

/** "What changed since X?" — baseline snapshot at/before `since` vs. the live counters now. */
export async function getChanges(address: Address, since: Date): Promise<ChangesResponse | null> {
  if (isDemoMode()) return demoChanges(address);
  const db = getDb();
  if (!db) return null;
  const a = address.toLowerCase();
  const [snaps, row, events, checks] = await Promise.all([
    db.select().from(activitySnapshots).where(and(eq(activitySnapshots.chainId, CHAIN_ID), eq(activitySnapshots.tokenAddress, a))).orderBy(asc(activitySnapshots.timestamp)),
    db.query.tokens.findFirst({ where: and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, a)) }),
    db.select().from(feedEvents).where(and(eq(feedEvents.chainId, CHAIN_ID), eq(feedEvents.tokenAddress, a), gte(feedEvents.createdAt, since))).limit(50),
    db.select().from(verificationChecks).where(and(eq(verificationChecks.chainId, CHAIN_ID), eq(verificationChecks.tokenAddress, a), gte(verificationChecks.observedAt, since))).limit(50),
  ]);
  if (!row) return null;
  const { baseline, exact } = baselineFor(snaps, since);
  const current = { timestamp: new Date(), holders: row.holderCount, transactions: row.transferCount, buyers: row.uniqueBuyers, sellers: row.uniqueSellers, volume: row.volumeWei };
  return {
    since: since.toISOString(),
    baselineAt: baseline ? new Date(baseline.timestamp).toISOString() : null,
    baselineExact: exact,
    diffs: diffSnapshots(baseline, current),
    events: [
      ...events.map((e) => ({ kind: e.kind, message: e.message, at: e.createdAt.toISOString(), txHash: e.txHash })),
      ...checks.map((c) => ({ kind: `proof_${c.checkType}`, message: `${c.checkType} check: ${c.status.replace("_", " ")}`, at: c.observedAt.toISOString(), txHash: null })),
    ].sort((x, y) => +new Date(y.at) - +new Date(x.at)),
  };
}

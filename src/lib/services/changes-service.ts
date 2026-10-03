import { and, asc, eq, gte } from "drizzle-orm";
import type { Address } from "viem";
import { getDb, schema } from "../db/client";
import { baselineFor, diffSnapshots } from "../changes/diff";
import { isDemoMode } from "../demo/mode";
import { demoChanges } from "../demo/data";
import type { ChangesResponse } from "./types";
import type { NetworkSlug } from "../chain/networks";
import { serviceNetwork } from "./network";

const { activitySnapshots, tokens, feedEvents, verificationChecks } = schema;

/** "What changed since X?" — baseline snapshot at/before `since` vs. the live counters now. */
export async function getChanges(address: Address, since: Date, network?: NetworkSlug | string | null): Promise<ChangesResponse | null> {
  if (isDemoMode()) return demoChanges(address);
  const db = getDb();
  if (!db) return null;
  const CHAIN_ID = serviceNetwork(network).chainId;
  const a = address.toLowerCase();
  const [snaps, row, events, checks] = await Promise.all([
    db.select().from(activitySnapshots).where(and(eq(activitySnapshots.chainId, CHAIN_ID), eq(activitySnapshots.tokenAddress, a))).orderBy(asc(activitySnapshots.timestamp)),
    db.query.tokens.findFirst({ where: and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, a)) }),
    db.select().from(feedEvents).where(and(eq(feedEvents.chainId, CHAIN_ID), eq(feedEvents.tokenAddress, a), gte(feedEvents.createdAt, since))).limit(50),
    db.select().from(verificationChecks).where(and(eq(verificationChecks.chainId, CHAIN_ID), eq(verificationChecks.tokenAddress, a), gte(verificationChecks.observedAt, since))).limit(50),
  ]);
  if (!row) return null;
  const { baseline, exact } = baselineFor(snaps, since);
  // Counters are only comparable when the token's complete history is indexed.
  const known = row.activityCovered;
  const current = { timestamp: new Date(), holders: known ? row.holderCount : null, transactions: known ? row.transferCount : null, buyers: known ? row.uniqueBuyers : null, sellers: known ? row.uniqueSellers : null, volume: known ? row.volumeWei : null };
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

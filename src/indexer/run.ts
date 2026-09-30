import { sql } from "drizzle-orm";
import { getProvider } from "../lib/chain/provider";
import { getDb, getSql } from "../lib/db/client";
import { log } from "../lib/util/log";
import { VibeIndexer } from "./indexer";
import { recheckStaleProofs } from "../lib/services/proof-service";

const once = process.argv.includes("--once");
const db = getDb();
if (!db) {
  console.error("DATABASE_URL is required for the indexer.");
  process.exit(1);
}

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

const indexer = new VibeIndexer(getProvider(), db, {
  shouldStop: () => stopping,
  initialBackfillBlocks: process.env.INDEXER_INITIAL_BACKFILL_BLOCKS ? BigInt(process.env.INDEXER_INITIAL_BACKFILL_BLOCKS) : undefined,
  maxTailBlocksPerTick: process.env.INDEXER_MAX_TAIL_BLOCKS ? BigInt(process.env.INDEXER_MAX_TAIL_BLOCKS) : undefined,
});
if (process.argv.includes("--recount")) {
  // Recompute counters for all covered tokens (e.g. after changing holder exclusion rules).
  const rows = await db.execute<{ address: string }>(sql`select address from tokens where activity_covered`);
  await indexer.refreshCounters(db, [...rows].map((r) => r.address));
  log("info", "indexer.recount", { tokens: rows.length });
  await getSql()?.end();
  process.exit(0);
}

const pollMs = Number(process.env.INDEXER_POLL_MS ?? 4000);
const PROOF_RECHECK_EVERY_MS = 10 * 60_000;
let lastProofRecheck = 0;

while (!stopping) {
  try {
    const r = await indexer.tick();
    const lag = r.head - r.activityThrough;
    log("info", "indexer.tick", { head: r.head, activityThrough: r.activityThrough, lag, newLaunches: r.newLaunches, newEvents: r.newEvents, backfilled: r.backfilled });
    if (Date.now() - lastProofRecheck > PROOF_RECHECK_EVERY_MS) {
      lastProofRecheck = Date.now();
      const n = await recheckStaleProofs().catch(() => 0);
      if (n) log("info", "indexer.proofs_rechecked", { count: n });
    }
    if (once && lag === 0n) break;
    if (lag > 0n) continue; // catching up: no sleep
  } catch (e) {
    log("error", "indexer.tick_failed", { error: e instanceof Error ? e.message : String(e) });
  }
  await new Promise((r) => setTimeout(r, pollMs));
}
await getSql()?.end();

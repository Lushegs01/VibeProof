import { getProvider } from "../lib/chain/provider";
import { getDb, getSql } from "../lib/db/client";
import { recheckStaleProofs } from "../lib/services/proof-service";
import { log } from "../lib/util/log";
import { VibeIndexer, type IndexerOptions } from "./indexer";

/** Arbitrary constant key for pg_advisory_lock: at most one indexer runs per database. */
export const INDEXER_LOCK_KEY = 4_663_000_001;

export type JobResult =
  | { status: "skipped"; reason: string }
  | { status: "ok"; ticks: number; head: string; activityThrough: string; lag: string; newLaunches: number; newEvents: number; backfilled: number; proofsRechecked: number; ms: number; stoppedByBudget: boolean };

/**
 * Hold the indexer advisory lock on a dedicated connection for the duration of `fn`.
 * Returns null (without running fn) if another indexer already holds it.
 */
export async function withIndexerLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const sql = getSql();
  if (!sql) throw new Error("No database configured");
  const conn = await sql.reserve();
  try {
    const [{ locked }] = await conn<{ locked: boolean }[]>`select pg_try_advisory_lock(${INDEXER_LOCK_KEY}) as locked`;
    if (!locked) return null;
    try {
      return await fn();
    } finally {
      await conn`select pg_advisory_unlock(${INDEXER_LOCK_KEY})`;
    }
  } finally {
    conn.release();
  }
}

/**
 * One bounded indexer run for serverless schedulers (Vercel Cron, GitHub Actions, …).
 * Keeps ticking until caught up or the time budget is spent; every range commits
 * atomically, so a run cut short simply resumes on the next invocation.
 */
export async function runIndexerJob(opts: { budgetMs: number; options?: IndexerOptions; recheckProofs?: boolean }): Promise<JobResult> {
  const db = getDb();
  if (!db) return { status: "skipped", reason: "no database configured" };
  const started = Date.now();
  const deadline = started + opts.budgetMs;
  const outOfTime = () => Date.now() > deadline;

  const result = await withIndexerLock(async () => {
    const indexer = new VibeIndexer(getProvider(), db, {
      // Smaller ranges than the long-running worker so each commit fits comfortably in the budget.
      launchChunk: 100_000n,
      maxTailBlocksPerTick: 10_000n,
      backfillPerTick: 5,
      ...opts.options,
      shouldStop: outOfTime,
    });
    let ticks = 0;
    let last = { head: 0n, activityThrough: 0n };
    let newLaunches = 0;
    let newEvents = 0;
    let backfilled = 0;
    do {
      const r = await indexer.tick();
      ticks++;
      last = r;
      newLaunches += r.newLaunches;
      newEvents += r.newEvents;
      backfilled += r.backfilled;
      if (r.activityThrough >= r.head) break;
    } while (!outOfTime());
    const proofsRechecked = opts.recheckProofs && !outOfTime() ? await recheckStaleProofs(3).catch(() => 0) : 0;
    return {
      status: "ok" as const,
      ticks,
      head: last.head.toString(),
      activityThrough: last.activityThrough.toString(),
      lag: (last.head - last.activityThrough).toString(),
      newLaunches,
      newEvents,
      backfilled,
      proofsRechecked,
      ms: Date.now() - started,
      stoppedByBudget: outOfTime(),
    };
  });
  if (!result) return { status: "skipped", reason: "another indexer run holds the lock" };
  log("info", "indexer.job", result);
  return result;
}

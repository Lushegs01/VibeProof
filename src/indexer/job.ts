import { assertChainId, getProvider } from "../lib/chain/provider";
import { activeNetwork, NETWORKS, type NetworkSlug } from "../lib/chain/networks";
import { indexerNetworks } from "../lib/chain/chains";
import { redactSecrets } from "../lib/chain/rpc-errors";
import { getDb, getSql, schema } from "../lib/db/client";
import { isDemoMode } from "../lib/demo/mode";
import { recheckStaleProofs } from "../lib/services/proof-service";
import { log } from "../lib/util/log";
import { VibeIndexer, type IndexerOptions, type TickResult } from "./indexer";
import { executionStatus, type JobStatus } from "./result";
import { getCursor } from "./state";

/**
 * pg_advisory_lock namespace. The lock is taken per chain — pg_try_advisory_lock(NS, chainId) —
 * so at most one indexer processes a given chain's cursors, while two chains can index in parallel.
 */
export const INDEXER_LOCK_NS = 4_663_000;
/** @deprecated single-key lock from earlier versions (kept so old and new processes never overlap). */
export const INDEXER_LOCK_KEY = 4_663_000_001;

export type NetworkJobResult =
  | { network: NetworkSlug; status: "skipped"; reason: string }
  | {
      network: NetworkSlug;
      status: "ok";
      ticks: number;
      head: string;
      activityThrough: string;
      lag: string;
      newLaunches: number;
      newEvents: number;
      backfilled: number;
      backfillFailed: number;
      metadataFetched: number;
      metadataProcessed: number;
      metadataFailed: number;
      reorgs: number;
      ms: number;
      stoppedByBudget: boolean;
      chainId: number;
      previousIndexedBlock: string | null;
      madeProgress: boolean;
      lastSuccessfulAt: string | null;
      failures: string[];
    }
  | { network: NetworkSlug; status: "error"; error: string };

export type JobResult =
  | { status: "skipped"; reason: string }
  | {
      status: Exclude<JobStatus, "skipped">;
      ticks: number;
      head: string | null;
      activityThrough: string | null;
      lag: string | null;
      newLaunches: number;
      newEvents: number;
      backfilled: number;
      failedJobs: number;
      metadataProcessed: number;
      metadataFailed: number;
      proofsRechecked: number;
      ms: number;
      stoppedByBudget: boolean;
      networks: NetworkJobResult[];
      failures: string[];
    };

/**
 * Hold the indexer advisory lock for `chainId` on a dedicated connection for the duration of `fn`.
 * Returns null (without running fn) if another indexer already holds it. `alive()` lets long
 * loops check that the lock connection is still up (a dropped connection releases the lock).
 */
export async function withIndexerLock<T>(fn: (alive: () => Promise<boolean>) => Promise<T>, chainId = activeNetwork().chainId): Promise<T | null> {
  const sql = getSql();
  if (!sql) throw new Error("No database configured");
  const conn = await sql.reserve();
  try {
    const [{ locked }] = await conn<{ locked: boolean }[]>`select pg_try_advisory_lock(${INDEXER_LOCK_NS}::int, ${chainId}::int) as locked`;
    if (!locked) return null;
    // Earlier versions locked the single key INDEXER_LOCK_KEY (testnet only). Hold it too on testnet,
    // so a not-yet-upgraded process can never run alongside this one.
    const legacyKey = chainId === 46630 ? INDEXER_LOCK_KEY : null;
    let legacy = true;
    if (legacyKey !== null) [{ legacy }] = await conn<{ legacy: boolean }[]>`select pg_try_advisory_lock(${legacyKey}::bigint) as legacy`;
    try {
      if (!legacy) return null;
      const alive = async () => {
        try {
          await conn`select 1`;
          return true;
        } catch {
          return false;
        }
      };
      return await fn(alive);
    } finally {
      if (legacyKey !== null && legacy) await conn`select pg_advisory_unlock(${legacyKey}::bigint)`.catch(() => {});
      await conn`select pg_advisory_unlock(${INDEXER_LOCK_NS}::int, ${chainId}::int)`.catch(() => {});
    }
  } finally {
    conn.release();
  }
}

/**
 * One bounded indexer run for serverless schedulers (Vercel Cron, GitHub Actions, …) over every
 * configured network. Keeps ticking until caught up or the time budget is spent; every range
 * commits atomically, so a run cut short simply resumes on the next invocation.
 */
async function executeIndexerJob(opts: { budgetMs: number; options?: IndexerOptions; recheckProofs?: boolean; networks?: NetworkSlug[] }): Promise<JobResult> {
  if (isDemoMode()) return { status: "skipped", reason: "demo mode never indexes live data" };
  const db = getDb();
  if (!db) throw new Error("No database configured; indexer cannot execute");
  if (!Number.isFinite(opts.budgetMs) || opts.budgetMs <= 0) throw new Error("Invalid indexer budget");
  const started = Date.now();
  const deadline = started + opts.budgetMs;
  const outOfTime = () => Date.now() > deadline;
  const nets = opts.networks ?? indexerNetworks();
  const results: NetworkJobResult[] = [];

  for (const slug of nets) {
    if (outOfTime()) {
      results.push({ network: slug, status: "skipped", reason: "time budget spent" });
      continue;
    }
    const chainId = NETWORKS[slug].chainId;
    try {
      const r = await withIndexerLock(async (alive) => {
        const provider = getProvider(slug);
        await assertChainId(provider);
        const previous = await getCursor(db, `activity:${chainId}`);
        const failures: string[] = [];
        let lockLost = false;
        const indexer = new VibeIndexer(provider, db, {
          // Smaller ranges than the long-running worker so each commit fits comfortably in the budget.
          maxLaunchBlocksPerRange: 2_000_000n,
          maxTailBlocksPerTick: 10_000n,
          backfillPerTick: 400,
          ...opts.options,
          shouldStop: () => outOfTime() || lockLost,
        });
        let ticks = 0;
        let last = { head: 0n, activityThrough: 0n };
        let newLaunches = 0;
        let newEvents = 0;
        let backfilled = 0;
        let backfillFailed = 0;
        let metadataFetched = 0;
        let metadataFailed = 0;
        let reorgs = 0;
        do {
          let t: TickResult;
          try {
            t = await indexer.tick();
          } catch (e) {
            await indexer.heartbeat({ ok: false, error: e }).catch(() => {});
            if (!ticks) throw e;
            failures.push(redactSecrets(e instanceof Error ? e.message : String(e)));
            break;
          }
          failures.push(...(t.failures ?? []));
          if (t.skipped) {
            failures.push(t.skipped);
            break;
          }
          ticks++;
          last = t;
          newLaunches += t.newLaunches;
          newEvents += t.newEvents;
          backfilled += t.backfilled;
          backfillFailed += t.backfillFailed;
          metadataFetched += t.metadataFetched;
          metadataFailed += t.metadataFailed ?? 0;
          if (t.reorg.detected) reorgs++;
          if (!(await alive())) {
            lockLost = true;
            failures.push("advisory lock connection lost");
          }
          if (t.activityThrough >= t.safeHead && !t.backfilled && !t.metadataFetched) break;
        } while (!outOfTime() && !lockLost);
        return {
          network: slug,
          chainId,
          previousIndexedBlock: previous?.toString() ?? null,
          madeProgress:
            (previous === null ? last.activityThrough > 0n : last.activityThrough > previous) ||
            newLaunches > 0 ||
            newEvents > 0 ||
            backfilled > 0 ||
            metadataFetched > metadataFailed,
          lastSuccessfulAt: failures.length || backfillFailed || metadataFailed ? null : new Date().toISOString(),
          failures,
          status: "ok" as const,
          ticks,
          head: last.head.toString(),
          activityThrough: last.activityThrough.toString(),
          lag: (last.head - last.activityThrough).toString(),
          newLaunches,
          newEvents,
          backfilled,
          backfillFailed,
          metadataFetched,
          metadataProcessed: metadataFetched,
          metadataFailed,
          reorgs,
          ms: Date.now() - started,
          stoppedByBudget: outOfTime(),
        };
      }, chainId);
      results.push(r ?? { network: slug, status: "skipped", reason: "another indexer run holds the lock" });
    } catch (e) {
      const error = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300);
      log("error", "indexer.job_network_failed", { network: slug, error });
      results.push({ network: slug, status: "error", error });
    }
  }

  const ok = results.filter((r): r is Extract<NetworkJobResult, { status: "ok" }> => r.status === "ok");
  if (executionStatus(results) === "skipped") return { status: "skipped", reason: "another indexer run holds the lock" };
  const failures: string[] = [];
  let proofsRechecked = 0;
  if (opts.recheckProofs && !outOfTime()) {
    try {
      proofsRechecked = await recheckStaleProofs(3, 6, () => failures.push("Proof recheck failed"));
    } catch (e) {
      failures.push(redactSecrets(e instanceof Error ? e.message : String(e)));
    }
  }
  const primary = ok[0];
  const result: JobResult = {
    status: failures.length && ok.length ? "partial_success" : (executionStatus(results) as Exclude<JobStatus, "skipped">),
    failures,
    ticks: ok.reduce((n, r) => n + r.ticks, 0),
    head: primary?.head ?? null,
    activityThrough: primary?.activityThrough ?? null,
    lag: primary?.lag ?? null,
    newLaunches: ok.reduce((n, r) => n + r.newLaunches, 0),
    newEvents: ok.reduce((n, r) => n + r.newEvents, 0),
    backfilled: ok.reduce((n, r) => n + r.backfilled, 0),
    metadataProcessed: ok.reduce((n, r) => n + r.metadataProcessed, 0),
    metadataFailed: ok.reduce((n, r) => n + r.metadataFailed, 0),
    failedJobs:
      ok.reduce((n, r) => n + r.backfillFailed + r.metadataFailed + r.failures.filter((f) => !/^\d+ metadata job/.test(f)).length, 0) +
      results.filter((r) => r.status === "error").length +
      failures.length,
    proofsRechecked,
    ms: Date.now() - started,
    stoppedByBudget: outOfTime(),
    networks: results,
  };
  log("info", "indexer.job", result);
  return result;
}

/** Persist the execution receipt before acknowledging the scheduler. */
export async function runIndexerJob(opts: Parameters<typeof executeIndexerJob>[0]): Promise<JobResult> {
  const result = await executeIndexerJob(opts);
  const db = isDemoMode() ? null : getDb();
  if (db) await db.insert(schema.indexerRuns).values({ id: crypto.randomUUID(), status: result.status, report: result });
  return result;
}

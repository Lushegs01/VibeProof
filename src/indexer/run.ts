import { and, eq, sql } from "drizzle-orm";
import { createPublicClient, webSocket } from "viem";
import { assertChainId, getProvider } from "../lib/chain/provider";
import { getChainConfig, indexerNetworks } from "../lib/chain/chains";
import { NETWORKS, isNetworkSlug, type NetworkSlug } from "../lib/chain/networks";
import { redactSecrets } from "../lib/chain/rpc-errors";
import { getDb, getSql, schema } from "../lib/db/client";
import { isDemoMode } from "../lib/demo/mode";
import { log } from "../lib/util/log";
import { launchpadAdapters } from "../lib/launchpads/registry";
import { VibeIndexer } from "./indexer";
import { recheckStaleProofs } from "../lib/services/proof-service";
import { withIndexerLock } from "./job";

/**
 *   npm run indexer              run forever: catch up, then follow the chain
 *   npm run indexer:once         run until launches + activity reach the head, then exit
 *   npm run indexer:bootstrap    migrate, verify RPC chain id + deployments, then like --once
 *       --drain                  …and keep going until the historical backfill queue is empty
 *   npm run indexer:recount      recompute counters for all covered tokens
 *   npm run indexer -- --retry-dead   move dead-lettered backfills back to pending
 *   --network=robinhood-testnet  restrict to one network (default: INDEXER_NETWORKS or the active network)
 */
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const netArg = args.find((a) => a.startsWith("--network="))?.split("=")[1];
const bootstrap = flag("--bootstrap");
const once = flag("--once") || bootstrap;
const drain = flag("--drain");

if (isDemoMode()) {
  console.error("NEXT_PUBLIC_DEMO_MODE=true: the indexer never runs in demo mode (demo data and live data are never mixed).");
  process.exit(1);
}
if (netArg && !isNetworkSlug(netArg)) {
  console.error(`Unknown --network ${netArg}. Supported: ${Object.keys(NETWORKS).join(", ")}`);
  process.exit(1);
}
const networks: NetworkSlug[] = netArg ? [netArg as NetworkSlug] : indexerNetworks();

if (bootstrap) {
  // Migrations are idempotent; run them first so an empty database is usable.
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["--import", "tsx", "src/lib/db/migrate.ts"], { stdio: "inherit" });
}

const db = getDb();
if (!db) {
  console.error("DATABASE_URL is required for the indexer.");
  process.exit(1);
}

let stopping = false;
const wakers = new Set<() => void>();
const stop = () => {
  stopping = true;
  for (const w of wakers) w();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

if (flag("--recount")) {
  for (const slug of networks) {
    const chainId = NETWORKS[slug].chainId;
    const indexer = new VibeIndexer(getProvider(slug), db, {});
    const rows = await db.execute<{ address: string }>(sql`select address from tokens where chain_id = ${chainId} and activity_covered`);
    await indexer.refreshCounters(db, [...rows].map((r) => r.address));
    log("info", "indexer.recount", { network: slug, tokens: rows.length });
  }
  await getSql()?.end();
  process.exit(0);
}

if (flag("--retry-dead")) {
  for (const slug of networks) {
    const res = await db
      .update(schema.backfillQueue)
      .set({ status: "pending", attempts: 0, nextAttemptAt: null, updatedAt: new Date() })
      .where(and(eq(schema.backfillQueue.chainId, NETWORKS[slug].chainId), eq(schema.backfillQueue.status, "dead")))
      .returning({ t: schema.backfillQueue.tokenAddress });
    log("info", "indexer.backfill.retry_dead", { network: slug, count: res.length });
  }
  await getSql()?.end();
  process.exit(0);
}

/** Resolves after `ms`, or earlier when a new block arrives over WebSocket (if configured) or on stop. */
function sleeper(slug: NetworkSlug) {
  let wake: (() => void) | null = null;
  const cfg = getChainConfig(slug)!;
  if (cfg.wssUrl) {
    try {
      const ws = createPublicClient({ chain: cfg.chain, transport: webSocket(cfg.wssUrl, { retryCount: 5 }) });
      ws.watchBlockNumber({ emitOnBegin: false, onBlockNumber: () => wake?.(), onError: (e) => log("warn", "indexer.ws_error", { network: slug, error: redactSecrets(e.message).slice(0, 200) }) });
      log("info", "indexer.ws_enabled", { network: slug });
    } catch (e) {
      log("warn", "indexer.ws_unavailable", { network: slug, error: redactSecrets(e instanceof Error ? e.message : String(e)) });
    }
  }
  return (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        wake = null;
        wakers.delete(done);
        resolve();
      };
      const t = setTimeout(done, ms);
      wake = done;
      wakers.add(done);
    });
}

async function runNetwork(slug: NetworkSlug) {
  const provider = getProvider(slug);
  const chainId = NETWORKS[slug].chainId;
  await assertChainId(provider);
  const deployments = launchpadAdapters(chainId).flatMap((a) => a.deployments());
  if (bootstrap) {
    for (const d of deployments) {
      const code = await provider.getBytecode(d.factory);
      if (!code || code === "0x") throw new Error(`${slug}: configured factory ${d.factory} (${d.id}) has no bytecode. Refusing to index a stale or wrong deployment.`);
    }
  }
  if (!deployments.length) log("warn", "indexer.no_deployments", { network: slug, message: "No launchpad deployment is configured for this network; no launches will be discovered. See README → Vibe deployment discovery." });

  const ran = await withIndexerLock(async (alive) => {
    let lockLost = false;
    const indexer = new VibeIndexer(provider, db!, {
      shouldStop: () => stopping || lockLost,
      initialBackfillBlocks: process.env.INDEXER_INITIAL_BACKFILL_BLOCKS ? BigInt(process.env.INDEXER_INITIAL_BACKFILL_BLOCKS) : undefined,
      maxTailBlocksPerTick: process.env.INDEXER_MAX_TAIL_BLOCKS ? BigInt(process.env.INDEXER_MAX_TAIL_BLOCKS) : undefined,
    });
    log("info", "indexer.started", { network: slug, chainId, deployments: deployments.map((d) => d.id), mode: bootstrap ? "bootstrap" : once ? "once" : "continuous", drain });
    const pollMs = Number(process.env.INDEXER_POLL_MS ?? 4000);
    const sleep = sleeper(slug);
    const PROOF_RECHECK_EVERY_MS = 10 * 60_000;
    let lastProofRecheck = 0;
    let failures = 0;
    while (!stopping && !lockLost) {
      try {
        const r = await indexer.tick();
        failures = 0;
        const lag = r.head - r.activityThrough;
        log("info", "indexer.tick", { network: slug, head: r.head, safeHead: r.safeHead, launchesThrough: r.launchesThrough, activityThrough: r.activityThrough, lag, newLaunches: r.newLaunches, newEvents: r.newEvents, backfilled: r.backfilled, backfillFailed: r.backfillFailed, metadataFetched: r.metadataFetched, reorg: r.reorg.detected ? r.reorg.ancestor : null });
        if (Date.now() - lastProofRecheck > PROOF_RECHECK_EVERY_MS) {
          lastProofRecheck = Date.now();
          const n = await recheckStaleProofs().catch(() => 0);
          if (n) log("info", "indexer.proofs_rechecked", { count: n });
        }
        const caughtUp = r.activityThrough >= r.safeHead && r.launchesThrough >= r.safeHead;
        if (once && caughtUp) {
          if (!drain) break;
          const [q] = await db!.execute<{ n: string }>(sql`select count(*)::text as n from backfill_queue where chain_id = ${chainId} and status in ('pending', 'started') or (chain_id = ${chainId} and status = 'failed' and next_attempt_at <= now())`);
          if (Number(q?.n ?? 0) === 0) break;
          continue;
        }
        if (!caughtUp || r.backfilled > 0) continue; // still catching up: no sleep
      } catch (e) {
        failures++;
        const msg = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 500);
        log("error", "indexer.tick_failed", { network: slug, error: msg, consecutiveFailures: failures });
        await indexer.heartbeat({ ok: false, error: msg }).catch(() => {});
        if (!(await alive())) lockLost = true;
        await sleep(Math.min(60_000, pollMs * 2 ** Math.min(failures, 4)));
        continue;
      }
      if (!(await alive())) {
        lockLost = true;
        log("error", "indexer.lock_lost", { network: slug });
        break;
      }
      await sleep(pollMs);
    }
    await db!.update(schema.indexerStatus).set({ state: "idle", updatedAt: new Date() }).where(eq(schema.indexerStatus.chainId, chainId)).catch(() => {});
    return true;
  }, chainId);
  if (ran === null) log("warn", "indexer.lock_held", { network: slug, message: "Another indexer (e.g. the scheduled job) holds this network's lock; not starting." });
}

let exitCode = 0;
await Promise.all(
  networks.map((slug) =>
    runNetwork(slug).catch((e) => {
      exitCode = 1;
      log("error", "indexer.fatal", { network: slug, error: redactSecrets(e instanceof Error ? e.message : String(e)) });
    }),
  ),
);
await getSql()?.end();
process.exit(exitCode);

import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { getRedis } from "../cache/cache";
import { getProvider, type ChainProvider } from "../chain/provider";
import { getChainConfig, indexerNetworks } from "../chain/chains";
import { activeNetworkSlug, NETWORKS, type NetworkSlug } from "../chain/networks";
import { redactSecrets } from "../chain/rpc-errors";
import { launchpadAdapters } from "../launchpads/registry";
import { isDemoMode } from "../demo/mode";
import { apiTraffic, metrics } from "../util/log";

type Probe<T> = { ok: true; value: T; ms: number } | { ok: false; error: string; ms: number };

async function probe<T>(fn: () => Promise<T>, timeoutMs = 8_000): Promise<Probe<T>> {
  const t = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, value, ms: Math.round(performance.now() - t) };
  } catch (e) {
    return { ok: false, error: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200), ms: Math.round(performance.now() - t) };
  } finally {
    clearTimeout(timer);
  }
}

export type IndexerHealthStatus = "healthy" | "lagging" | "stale" | "error" | "not_started" | "no_deployments" | "unavailable";

/** Blocks behind head before "lagging"; seconds without a successful tick before "stale". */
const LAG_BLOCKS = () => Number(process.env.HEALTH_MAX_LAG_BLOCKS ?? 2_000);
const STALE_S = () => Number(process.env.HEALTH_MAX_TICK_AGE_S ?? 900);

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function networkHealth(slug: NetworkSlug, opts: { provider?: ChainProvider } = {}) {
  const net = NETWORKS[slug];
  const cfg = getChainConfig(slug)!;
  const db = getDb();
  const provider = opts.provider ?? getProvider(slug);
  const deployments = launchpadAdapters(net.chainId).flatMap((a) =>
    a.deployments().map((d) => ({
      launchpad: a.id,
      id: d.id,
      version: d.version,
      factory: d.factory,
      startBlock: d.startBlock?.toString() ?? null,
      provenance: d.provenance.source,
      verifiedAt: d.provenance.verifiedAt,
    })),
  );
  const [head, chainId] = await Promise.all([
    probe(() => provider.getBlockNumber()),
    probe(async () => (provider.getChainId ? provider.getChainId() : provider.chainId)),
  ]);
  const rpc = {
    status: head.ok ? "ok" : "error",
    latencyMs: head.ms,
    chainId: chainId.ok ? chainId.value : null,
    chainIdMatches: chainId.ok ? chainId.value === net.chainId : null,
    publicEndpoint: cfg.usingPublicRpc,
    error: head.ok ? undefined : head.error,
  };
  const warnings: string[] = [];
  if (cfg.usingPublicRpc)
    warnings.push(
      `Using the public ${net.name} RPC, which is rate-limited. Set ${slug === "robinhood-mainnet" ? "ROBINHOOD_MAINNET_RPC_URL" : "ROBINHOOD_TESTNET_RPC_URL"} to a provider endpoint for production.`,
    );
  if (rpc.chainIdMatches === false) warnings.push(`The configured RPC reports chain id ${rpc.chainId}, expected ${net.chainId}.`);
  if (!deployments.length) warnings.push(`No launchpad deployment is configured for ${net.name}; no launches will be discovered here.`);
  if (process.env.INDEXER_MIN_START_BLOCK)
    warnings.push(`INDEXER_MIN_START_BLOCK=${process.env.INDEXER_MIN_START_BLOCK} is set: launches before that block are deliberately not indexed.`);
  const headBlock = head.ok ? head.value : null;

  if (!db) {
    return {
      network: slug,
      chainId: net.chainId,
      name: net.name,
      rpc,
      indexer: { status: "unavailable" as IndexerHealthStatus, headBlock: headBlock?.toString() ?? null, reason: "DATABASE_URL is not set" },
      deployments,
      warnings,
    };
  }
  const c = net.chainId;
  const q = await probe(async () => {
    const [cursors, status, queue, meta, counts] = await Promise.all([
      db.execute<{ key: string; last_block: string; updated_at: Date }>(
        sql`select key, last_block::text, updated_at from indexer_state where key like ${"%:" + c} or key like ${"%:" + c + ":%"}`,
      ),
      db.execute<Record<string, unknown>>(sql`select * from indexer_status where chain_id = ${c}`),
      db.execute<{ status: string; n: string; recent_jobs: number; recent_retries: number }>(sql`select status, count(*)::text as n,
        count(*) filter (where updated_at >= now() - interval '5 minutes')::int as recent_jobs,
        count(*) filter (where updated_at >= now() - interval '5 minutes' and attempts>1)::int as recent_retries
        from backfill_queue where chain_id = ${c} group by status`),
      db.execute<{ status: string; n: string }>(sql`select status, count(*)::text as n from token_metadata where chain_id = ${c} group by status`),
      db.execute<{ launches: string; covered: string; tokens: string; last_launch: Date | null; last_event: Date | null }>(sql`
        select (select count(*) from launches where chain_id = ${c})::text as launches,
               (select count(*) from tokens where chain_id = ${c} and is_vibe_launch and activity_covered)::text as covered,
               (select count(*) from tokens where chain_id = ${c} and is_vibe_launch)::text as tokens,
               (select max(created_at) from launches where chain_id = ${c}) as last_launch,
               (select max(timestamp) from transaction_events where chain_id = ${c}) as last_event`),
    ]);
    return {
      cursors: [...cursors],
      status: [...status][0] ?? null,
      recentBackfills: { jobs: [...queue].reduce((n, r) => n + r.recent_jobs, 0), retried: [...queue].reduce((n, r) => n + r.recent_retries, 0) },
      queue: Object.fromEntries([...queue].map((r) => [r.status, Number(r.n)])),
      meta: Object.fromEntries([...meta].map((r) => [r.status, Number(r.n)])),
      counts: [...counts][0],
    };
  });
  if (!q.ok)
    return {
      network: slug,
      chainId: c,
      name: net.name,
      rpc,
      indexer: { status: "unavailable" as IndexerHealthStatus, headBlock: headBlock?.toString() ?? null, reason: q.error },
      deployments,
      warnings,
    };

  const { cursors, status: hb, queue, meta, counts, recentBackfills } = q.value;
  const cursor = (k: string) => {
    const r = cursors.find((x) => x.key === k);
    return r ? BigInt(r.last_block) : null;
  };
  const activity = cursor(`activity:${c}`);
  const activityStart = cursor(`activity_start:${c}`);
  const launchCursors = Object.fromEntries(
    cursors.filter((r) => r.key.startsWith(`launches:${c}:`)).map((r) => [r.key.slice(`launches:${c}:`.length), r.last_block]),
  );
  const launchVals = Object.values(launchCursors).map((v) => BigInt(v));
  const launchesThrough = launchVals.length ? launchVals.reduce((a, b) => (b < a ? b : a)) : null;
  const lag = headBlock !== null && activity !== null ? headBlock - activity : null;
  const lastSuccess = hb?.last_success_at ? new Date(hb.last_success_at as string) : null;
  const lastErrorAt = hb?.last_error_at ? new Date(hb.last_error_at as string) : null;
  const tickAge = lastSuccess ? Math.round((Date.now() - lastSuccess.getTime()) / 1000) : null;

  let status: IndexerHealthStatus;
  if (activity === null && Number(counts?.launches ?? 0) === 0) status = deployments.length ? "not_started" : "no_deployments";
  else if (activity === null) status = "not_started";
  else if (lastErrorAt && (!lastSuccess || lastErrorAt > lastSuccess) && hb?.state === "error") status = "error";
  else if (tickAge === null || tickAge > STALE_S()) status = "stale";
  else if (lag !== null && lag > BigInt(LAG_BLOCKS())) status = "lagging";
  else status = "healthy";

  if (status === "not_started" && deployments.length)
    warnings.push("The database has no indexed data for this network yet. Run `npm run indexer:bootstrap` (or schedule GET /api/cron/indexer).");
  if (status === "stale") warnings.push(`No successful indexer tick for ${tickAge}s. Is the indexer running?`);
  if ((queue.dead ?? 0) > 0)
    warnings.push(`${queue.dead} token backfill(s) dead-lettered after repeated failures; run \`npm run indexer -- --retry-dead\` after fixing the cause.`);

  const rawProvider = (hb?.provider ?? null) as Partial<import("../chain/provider").ProviderStats> | null;
  const telemetryFresh = hb?.last_tick_at && Date.now() - new Date(hb.last_tick_at as string).getTime() < 300_000;
  const provider_ = rawProvider
    ? { ...rawProvider, window5m: telemetryFresh ? rawProvider.window5m : undefined, errorRate5m: telemetryFresh ? rawProvider.errorRate5m : null }
    : null;
  return {
    network: slug,
    chainId: c,
    name: net.name,
    rpc,
    indexer: {
      status,
      headBlock: headBlock?.toString() ?? null,
      indexedThrough: activity?.toString() ?? null,
      lagBlocks: lag !== null ? Number(lag) : null,
      lagSecondsApprox: lag !== null ? Math.round((Number(lag) * net.approxBlockTimeMs) / 1000) : null,
      activityCursor: activity?.toString() ?? null,
      activityStart: activityStart?.toString() ?? null,
      launchCursors,
      launchesThrough: launchesThrough?.toString() ?? null,
      heartbeatAgeSeconds: tickAge,
      lastTickAt: iso(hb?.last_tick_at as string),
      lastSuccessfulTickAt: iso(hb?.last_success_at as string),
      lastSuccessfulLaunchDiscoveryAt: iso(hb?.last_launch_discovery_at as string),
      lastSuccessfulActivityDiscoveryAt: iso(hb?.last_activity_at as string),
      lastBackfillAt: iso(hb?.last_backfill_at as string),
      lastReorgAt: iso(hb?.last_reorg_at as string),
      lastError: (hb?.last_error as string) ?? null,
      lastErrorAt: iso(hb?.last_error_at as string),
      latestLaunchAt: iso(counts?.last_launch),
      latestEventAt: iso(counts?.last_event),
      recentBackfills: { ...recentBackfills, retryShare: recentBackfills.jobs ? recentBackfills.retried / recentBackfills.jobs : null },
      providerTelemetryObservedAt: iso(hb?.last_tick_at as string),
      pendingBackfills: (queue.pending ?? 0) + (queue.started ?? 0),
      failedBackfills: (queue.failed ?? 0) + (queue.dead ?? 0),
      backfillQueue: {
        pending: queue.pending ?? 0,
        started: queue.started ?? 0,
        failed: queue.failed ?? 0,
        dead: queue.dead ?? 0,
        completed: queue.completed ?? 0,
      },
      metadata: meta,
      coverage: {
        launches: Number(counts?.launches ?? 0),
        fullyCovered: Number(counts?.covered ?? 0),
        incomplete: Number(counts?.tokens ?? 0) - Number(counts?.covered ?? 0),
      },
      providerErrorRate5m: provider_?.errorRate5m ?? null,
      provider: provider_,
      throughput: hb?.stats ?? null,
    },
    deployments,
    warnings,
  };
}

export async function healthReport() {
  const db = getDb();
  const redis = getRedis();
  const nets = [...new Set([activeNetworkSlug(), ...safeIndexerNetworks()])];
  const [dbR, redisR, ...netR] = await Promise.all([
    db ? probe(() => db.execute(sql`select 1`)) : Promise.resolve({ ok: false as const, error: "DATABASE_URL not set", ms: 0 }),
    redis ? probe(() => redis.ping()) : Promise.resolve({ ok: false as const, error: "REDIS_URL not set (in-memory fallback active)", ms: 0 }),
    ...nets.map((n) => networkHealth(n)),
  ]);
  const active = netR.find((n) => n.network === activeNetworkSlug())!;
  const healthy = dbR.ok && active.rpc.status === "ok" && active.rpc.chainIdMatches !== false;
  const body = {
    status: !healthy ? "down" : (["healthy", "no_deployments"] as string[]).includes(active.indexer.status) ? "ok" : "degraded",
    demo: isDemoMode(),
    activeNetwork: activeNetworkSlug(),
    chain: active.name,
    chainId: active.chainId,
    database: dbR.ok ? "ok" : "error",
    redis: redisR.ok ? "ok" : "error",
    rpc: active.rpc.status,
    indexer: active.indexer,
    // Flat fields kept for existing dashboards.
    latestBlock: active.indexer.headBlock !== null ? Number(active.indexer.headBlock) : null,
    indexedThrough: "indexedThrough" in active.indexer && active.indexer.indexedThrough !== null ? Number(active.indexer.indexedThrough) : null,
    lagBlocks: "lagBlocks" in active.indexer ? active.indexer.lagBlocks : null,
    networks: netR,
    latencyMs: { database: dbR.ms, redis: redisR.ms, rpc: active.rpc.latencyMs },
    errors: Object.fromEntries(
      [
        ["database", dbR.ok ? null : dbR.error],
        ["redis", redisR.ok ? null : redisR.error],
        ["rpc", active.rpc.error ?? null],
      ].filter(([, v]) => v),
    ),
    metrics: metrics.snapshot(),
    apiTraffic5m: apiTraffic.snapshot(),
    telemetryScope: "API traffic is process-local; aggregate structured logs for fleet-wide rates. RPC snapshots describe the last indexer heartbeat.",
    checkedAt: new Date().toISOString(),
  };
  return { body, httpStatus: healthy ? 200 : 503 };
}

function safeIndexerNetworks(): NetworkSlug[] {
  try {
    return indexerNetworks();
  } catch {
    return [];
  }
}

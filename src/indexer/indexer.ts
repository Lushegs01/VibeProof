import { and, eq, inArray, sql } from "drizzle-orm";
import { getAddress, type Abi, type Address, type Block, type Log } from "viem";
import type { ChainProvider } from "../lib/chain/provider";
import { getLogsAdaptive, StoppedError } from "../lib/chain/logs";
import { classifyRpcError, redactSecrets } from "../lib/chain/rpc-errors";
import type { DB } from "../lib/db/client";
import { schema } from "../lib/db/client";
import { ERC20_ABI, TRANSFER_EVENT } from "../lib/vibe/abis";
import type { VibeDeployment } from "../lib/vibe/contracts";
import { VibeAdapter } from "../lib/launchpads/vibe";
import type { DecodedGraduation, DecodedLaunch, DecodedTrade, LaunchpadAdapter, LaunchpadDeployment } from "../lib/launchpads/types";
import { log } from "../lib/util/log";
import { DEAD_ADDRESSES, ZERO_ADDRESS } from "../lib/util/address";
import { displayText } from "../lib/util/sanitize";
import { balanceDeltas, decodeTransfer, type DecodedTransfer } from "./decode";
import { TimestampResolver } from "./timestamps";
import { DbHeaderStore, canonicalHeader, deleteBlocksAbove, pruneCheckpoints, recentCheckpoints, storedBlock, writeCheckpoint } from "./blocks";
import { advanceCursor, cursorKeys, getCursor, lockCursor, setCursor, type Db, type Tx } from "./state";
import { processMetadataQueue, type MetadataWorkerOptions } from "./metadata-worker";

const { tokens, launches, holders, transactionEvents, activitySnapshots, feedEvents, backfillQueue, tokenMetadata, indexerStatus } = schema;

export type IndexerOptions = {
  /** Initial block span per factory log request (adapts to provider limits). */
  launchChunk?: bigint;
  /** Initial block span per topic-only tail request (adapts to provider limits). */
  tailChunk?: bigint;
  /** Max blocks the tail advances per tick, so launches/backfills interleave. */
  maxTailBlocksPerTick?: bigint;
  /** Max blocks one launch range covers before it is committed. */
  maxLaunchBlocksPerRange?: bigint;
  /** How far behind head the activity tail starts on first run. Older launches are backfilled through the queue. */
  initialBackfillBlocks?: bigint;
  /** Blocks behind head treated as not yet safe to index (default 5). */
  confirmations?: bigint;
  /** Queue every launch older than the activity start for a full-history backfill (default true). */
  historicalBackfill?: boolean;
  /** Tokens per batched (multi-address) backfill request group. */
  backfillGroupSize?: number;
  /** Max tokens backfilled per tick. */
  backfillPerTick?: number;
  backfillMaxAttempts?: number;
  metadata?: MetadataWorkerOptions | false;
  /** Contract analyses of new launches per tick (0 disables). */
  analyzePerTick?: number;
  tokenMetaRepairPerTick?: number;
  snapshotEveryMs?: number;
  /** Stored checkpoints compared against the chain each tick. */
  reorgCheckDepth?: number;
  workerId?: string;
  shouldStop?: () => boolean;
};

export type TickResult = {
  head: bigint;
  safeHead: bigint;
  activityThrough: bigint;
  launchesThrough: bigint;
  newLaunches: number;
  newEvents: number;
  backfilled: number;
  backfillFailed: number;
  metadataFetched: number;
  reorg: { detected: boolean; ancestor: bigint | null };
  skipped?: string;
};

type LaunchRef = { token: string; curve: string | null; creator: string; pair: string | null; createdBlock: bigint };
export type TokenMeta = { name: string | null; symbol: string | null; decimals: number | null; totalSupply: bigint | null; status: "ok" | "partial" | "error"; error: string | null; block: bigint | null };
type Pair = { adapter: LaunchpadAdapter; dep: LaunchpadDeployment };

export class ReorgDetectedError extends Error {
  constructor(readonly block: bigint) {
    super(`Block ${block} is no longer canonical`);
    this.name = "ReorgDetectedError";
  }
}

const lc = (a: string) => a.toLowerCase();
const envBig = (k: string) => (process.env[k] ? BigInt(process.env[k]!) : undefined);
const envNum = (k: string) => (process.env[k] ? Number(process.env[k]) : undefined);
const errText = (e: unknown) => redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 500);

function isAdapterList(x: unknown[]): x is LaunchpadAdapter[] {
  return x.length > 0 && typeof (x[0] as LaunchpadAdapter).decodeLaunch === "function";
}

/**
 * The VibeProof indexer for ONE chain. Launchpad-agnostic: everything launchpad-specific comes
 * from LaunchpadAdapters (VibeAdapter by default).
 *
 * Invariants
 *  - A range's rows, its checkpoint and its cursor advance commit in one transaction; the cursor
 *    moves by compare-and-set, so data exists iff the cursor covers it.
 *  - Every chain event is keyed by (chain_id, tx_hash, log_index). Holder deltas, feed rows and
 *    status changes are applied only for rows actually inserted, so replaying any range is a no-op.
 *  - holders.balance == Σ deltas of stored transfer rows, so a reorg rollback can reverse it exactly.
 *  - A token's counters are presented only when its complete history from launch is stored.
 */
export class VibeIndexer {
  private ts: TimestampResolver;
  private covered = new Map<string, LaunchRef>();
  private curves = new Map<string, LaunchRef>();
  private coveredLoaded = false;
  private historicalEnqueued = false;
  readonly adapters: LaunchpadAdapter[];
  private pairs: Pair[];
  private keys: ReturnType<typeof cursorKeys>;
  private stats = { ticks: 0, launches: 0, events: 0, backfilled: 0, launchBlocks: 0n, tailBlocks: 0n, ms: 0 };

  constructor(
    private provider: ChainProvider,
    private db: DB,
    private opts: IndexerOptions = {},
    adaptersOrDeployments?: LaunchpadAdapter[] | VibeDeployment[],
  ) {
    const list = adaptersOrDeployments ?? [];
    this.adapters = list.length === 0 && adaptersOrDeployments ? [] : isAdapterList(list) ? list : list.length ? [new VibeAdapter(provider.chainId, list as VibeDeployment[])] : [new VibeAdapter(provider.chainId)];
    this.pairs = this.adapters.flatMap((adapter) => adapter.deployments().map((dep) => ({ adapter, dep })));
    this.keys = cursorKeys(provider.chainId);
    this.ts = new TimestampResolver(provider, new DbHeaderStore(db, provider.chainId));
  }

  get chainId() {
    return this.provider.chainId;
  }
  get deployments() {
    return this.pairs.map((p) => p.dep);
  }

  private stop() {
    return this.opts.shouldStop?.() ?? false;
  }
  private confirmations() {
    return this.opts.confirmations ?? envBig("INDEXER_CONFIRMATIONS") ?? 5n;
  }

  // ── Tick ─────────────────────────────────────────────────────────────────
  async tick(): Promise<TickResult> {
    const t0 = Date.now();
    const head = await this.provider.getBlockNumber();
    const conf = this.confirmations();
    const safeHead = head > conf ? head - conf : 0n;
    const base = { head, safeHead, newLaunches: 0, newEvents: 0, backfilled: 0, backfillFailed: 0, metadataFetched: 0 };

    const reorg = await this.checkReorg(head);
    if (reorg === "provider_behind") {
      const through = (await getCursor(this.db, this.keys.activity)) ?? 0n;
      log("warn", "indexer.provider_behind", { network: this.provider.slug, head });
      return { ...base, activityThrough: through, launchesThrough: through, reorg: { detected: false, ancestor: null }, skipped: "provider_behind" };
    }
    const start = await this.ensureActivityStart(safeHead);
    await this.enqueueHistorical(start);

    let newLaunches = 0;
    for (const p of this.pairs) {
      if (this.stop()) break;
      newLaunches += await this.indexLaunches(p, safeHead, start);
    }
    let launchesThrough = safeHead;
    for (const p of this.pairs) {
      const c = await getCursor(this.db, this.keys.launches(p.adapter.id, p.dep.id));
      if (c === null) launchesThrough = start - 1n < launchesThrough ? start - 1n : launchesThrough;
      else if (c < launchesThrough) launchesThrough = c;
    }
    const result: TickResult = { ...base, newLaunches, activityThrough: (await getCursor(this.db, this.keys.activity)) ?? start - 1n, launchesThrough, reorg: { detected: reorg !== null, ancestor: reorg } };
    if (!this.stop()) {
      await this.loadCovered();
      // The tail never passes a block whose launches are not indexed yet: a token launched there
      // would be marked covered while its early events were skipped.
      const { through, events } = await this.indexTail(launchesThrough < safeHead ? launchesThrough : safeHead);
      result.activityThrough = through;
      result.newEvents = events;
    }
    if (!this.stop()) {
      const b = await this.processBackfillQueue();
      result.backfilled = b.done;
      result.backfillFailed = b.failed;
    }
    if (!this.stop() && this.opts.metadata !== false) result.metadataFetched = await processMetadataQueue(this.db, this.chainId, { ...(this.opts.metadata || {}), shouldStop: this.opts.shouldStop }).catch((e) => (log("warn", "indexer.metadata_worker_failed", { error: errText(e) }), 0));
    if (!this.stop()) await this.repairTokenMeta(this.opts.tokenMetaRepairPerTick ?? 200).catch((e) => log("warn", "indexer.token_meta_repair_failed", { error: errText(e) }));
    if (!this.stop()) await this.analyzeNewLaunches(this.opts.analyzePerTick ?? envNum("INDEXER_ANALYZE_PER_TICK") ?? 3).catch((e) => log("warn", "indexer.analysis_failed", { error: errText(e) }));

    this.stats.ticks++;
    this.stats.launches += newLaunches;
    this.stats.events += result.newEvents;
    this.stats.backfilled += result.backfilled;
    this.stats.ms += Date.now() - t0;
    await this.heartbeat({ ok: true, head, newLaunches, newEvents: result.newEvents, backfilled: result.backfilled, reorg: reorg !== null }).catch(() => {});
    return result;
  }

  /** Heartbeat for /api/health (readable from any process). Never throws into the tick. */
  async heartbeat(r: { ok: boolean; head?: bigint; newLaunches?: number; newEvents?: number; backfilled?: number; reorg?: boolean; error?: unknown }) {
    const now = new Date();
    const provider = this.provider.stats?.() ?? null;
    const set: Partial<typeof indexerStatus.$inferInsert> = {
      network: this.provider.slug,
      state: r.ok ? "running" : "error",
      lastTickAt: now,
      provider: provider as never,
      stats: { ...this.stats, launchBlocks: this.stats.launchBlocks.toString(), tailBlocks: this.stats.tailBlocks.toString() } as never,
      updatedAt: now,
    };
    if (r.head !== undefined) set.headBlock = r.head;
    if (r.ok) set.lastSuccessAt = now;
    if (r.newLaunches) set.lastLaunchDiscoveryAt = now;
    if (r.newEvents) set.lastActivityAt = now;
    if (r.backfilled) set.lastBackfillAt = now;
    if (r.reorg) set.lastReorgAt = now;
    if (r.error) ((set.lastError = errText(r.error)), (set.lastErrorAt = now));
    await this.db
      .insert(indexerStatus)
      .values({ chainId: this.chainId, network: this.provider.slug, state: set.state!, startedAt: now, ...set })
      .onConflictDoUpdate({ target: indexerStatus.chainId, set });
  }

  async ensureActivityStart(head: bigint): Promise<bigint> {
    const existing = await getCursor(this.db, this.keys.activityStart);
    if (existing !== null) return existing;
    const env = envBig("INDEXER_ACTIVITY_START");
    const back = this.opts.initialBackfillBlocks ?? envBig("INDEXER_INITIAL_BACKFILL_BLOCKS") ?? 100_000n;
    const start = env ?? (head > back ? head - back : 1n);
    await this.db.transaction(async (tx) => {
      await setCursor(tx, this.keys.activityStart, start);
      await setCursor(tx, this.keys.activity, start - 1n);
      // Launches already indexed at/after the start are fully covered by the tail from here on.
      await tx
        .update(tokens)
        .set({ activityCovered: true, holderCount: 0, transferCount: 0, buyCount: 0, sellCount: 0, uniqueBuyers: 0, uniqueSellers: 0 })
        .where(and(eq(tokens.chainId, this.chainId), sql`${tokens.createdBlock} >= ${start}`, eq(tokens.activityCovered, false)));
    });
    log("info", "indexer.activity_start", { network: this.provider.slug, start });
    return start;
  }

  /** Queue every not-yet-covered launch older than the activity start (once per process; idempotent). */
  async enqueueHistorical(start: bigint) {
    if (this.historicalEnqueued || !this.historicalBackfillEnabled()) return;
    this.historicalEnqueued = true;
    const res = await this.db.execute(sql`
      insert into backfill_queue (chain_id, token_address, status, reason, priority, launch_block)
      select l.chain_id, l.token_address, 'pending', 'bootstrap', 0, l.block_number
      from launches l join tokens t on t.chain_id = l.chain_id and t.address = l.token_address
      where l.chain_id = ${this.chainId} and l.block_number < ${start} and not t.activity_covered
      on conflict (chain_id, token_address) do nothing`);
    const n = (res as unknown as { count?: number }).count ?? 0;
    if (n) log("info", "indexer.backfill.enqueued", { network: this.provider.slug, count: n, reason: "bootstrap" });
  }

  private historicalBackfillEnabled() {
    return this.opts.historicalBackfill ?? process.env.INDEXER_HISTORICAL_BACKFILL !== "false";
  }

  // ── Reorg protection ───────────────────────────────────────────────────
  /**
   * Compare stored checkpoints (newest first) with the chain. If the newest still matches, there
   * was no reorg (one header call). Otherwise roll back to the newest checkpoint that matches.
   */
  async checkReorg(head: bigint): Promise<bigint | null | "provider_behind"> {
    const cps = await recentCheckpoints(this.db, this.chainId, 1);
    if (!cps.length) return null;
    const newest = cps[0];
    if (newest.blockNumber > head) return "provider_behind";
    const canonical = async (b: bigint) => {
      try {
        return (await canonicalHeader(this.provider, b)).hash;
      } catch (e) {
        if (classifyRpcError(e).kind === "not_found") return "missing" as const;
        throw e;
      }
    };
    const h = await canonical(newest.blockNumber);
    if (h === "missing") return "provider_behind";
    if (h === newest.blockHash) return null;

    // Reorg. Every orphaned row sits above the fork point, and every block hash we stored above it
    // is orphaned too, so the highest stored block whose hash is still canonical is a safe ancestor.
    // Candidates: checkpoints, cached headers, and the block hashes of stored events and launches.
    const depth = this.opts.reorgCheckDepth ?? 256;
    const known = await this.db.execute<{ block_number: string; block_hash: string }>(sql`
      select block_number::text, block_hash from (
        select block_number, block_hash from chain_blocks where chain_id = ${this.chainId} and block_number < ${newest.blockNumber}
        union select block_number, block_hash from transaction_events where chain_id = ${this.chainId} and block_number < ${newest.blockNumber} and block_hash is not null
        union select block_number, block_hash from launches where chain_id = ${this.chainId} and block_number < ${newest.blockNumber} and block_hash is not null
      ) k order by block_number desc limit ${depth * 4}`);
    const byBlock = new Map<string, Set<string>>();
    for (const r of known) (byBlock.get(r.block_number) ?? byBlock.set(r.block_number, new Set()).get(r.block_number)!).add(r.block_hash);
    let ancestor: bigint | null = null;
    let checked = 0;
    for (const [b, hashes] of byBlock) {
      if (checked++ >= depth) break;
      const c = await canonical(BigInt(b));
      if (c && c !== "missing" && hashes.size === 1 && hashes.has(c)) {
        ancestor = BigInt(b);
        break;
      }
    }
    if (ancestor === null) {
      // Nothing we stored is canonical within the search window: replay everything the tail indexed.
      const start = (await getCursor(this.db, this.keys.activityStart)) ?? 1n;
      ancestor = start - 1n;
      log("error", "indexer.reorg_deeper_than_search", { network: this.provider.slug, checked, rewindTo: ancestor });
    }
    log("warn", "indexer.reorg_detected", { network: this.provider.slug, newestCheckpoint: newest.blockNumber, ancestor, checkedBlocks: checked });
    await this.rollback(ancestor);
    await this.heartbeat({ ok: true, reorg: true }).catch(() => {});
    return ancestor;
  }

  /**
   * Remove everything derived from blocks > ancestor and rewind cursors, in one transaction.
   * Holder balances are reversed from the deleted transfer rows (same delta rules as forward),
   * graduation status is recomputed from the remaining events, counters are refreshed.
   */
  async rollback(ancestor: bigint) {
    const c = this.chainId;
    await this.db.transaction(async (tx) => {
      const keys = await tx.execute<{ key: string; last_block: string }>(sql`select key, last_block::text from indexer_state where key like ${"%:" + c} or key like ${"%:" + c + ":%"} for update`);
      const deleted = await tx.execute<{ token_address: string; wallet_address: string | null; counterparty: string | null; event_type: string; amount: string | null }>(sql`
        delete from transaction_events where chain_id = ${c} and block_number > ${ancestor}
        returning token_address, wallet_address, counterparty, event_type, amount::text`);
      const rows = [...deleted];
      const transfers = rows.filter((r) => r.event_type === "transfer" && r.wallet_address && r.counterparty && r.amount !== null);
      const deltas = balanceDeltas(transfers.map((r) => ({ token: r.token_address as Address, from: r.counterparty as Address, to: r.wallet_address as Address, value: BigInt(r.amount!) })));
      await this.applyHolderDeltas(tx, [...deltas.entries()].map(([k, v]) => [k, -v] as [string, bigint]));
      const affected = new Set(rows.map((r) => r.token_address));

      const goneLaunches = await tx.execute<{ token_address: string; creator_address: string }>(sql`
        delete from launches where chain_id = ${c} and block_number > ${ancestor} returning token_address, creator_address`);
      const gone = [...goneLaunches].map((r) => r.token_address);
      if (gone.length) {
        await tx.delete(tokens).where(and(eq(tokens.chainId, c), inArray(tokens.address, gone), eq(tokens.isVibeLaunch, true)));
        await tx.delete(holders).where(and(eq(holders.chainId, c), inArray(holders.tokenAddress, gone)));
        await tx.delete(backfillQueue).where(and(eq(backfillQueue.chainId, c), inArray(backfillQueue.tokenAddress, gone)));
        await tx.delete(tokenMetadata).where(and(eq(tokenMetadata.chainId, c), inArray(tokenMetadata.tokenAddress, gone)));
        for (const g of gone) affected.delete(g);
      }
      await tx.execute(sql`delete from feed_events where chain_id = ${c} and block_number > ${ancestor}`);
      if (affected.size) await this.recomputeLaunchStatus(tx, [...affected]);

      const start = (await getCursor(tx, this.keys.activityStart)) ?? 0n;
      for (const k of [...keys]) {
        if (k.key === this.keys.activityStart) continue;
        if (BigInt(k.last_block) > ancestor) await setCursor(tx, k.key, k.key === this.keys.activity && ancestor < start - 1n ? start - 1n : ancestor);
      }
      if (ancestor < start - 1n) {
        // Backfilled tokens lost events in (ancestor, start) that the tail will not replay: re-queue them.
        await tx.execute(sql`
          with t as (update tokens set activity_covered = false, holder_count = null, transfer_count = null, buy_count = null, sell_count = null,
                       unique_buyers = null, unique_sellers = null, volume_wei = null, last_activity_at = null
                     where chain_id = ${c} and activity_covered and created_block < ${start} returning address, created_block)
          insert into backfill_queue (chain_id, token_address, status, reason, priority, launch_block)
          select ${c}, address, 'pending', 'reorg', 50, created_block from t
          on conflict (chain_id, token_address) do update set status = 'pending', reason = 'reorg', done_at = null, attempts = 0, next_attempt_at = null`);
      }
      await deleteBlocksAbove(tx, c, ancestor);
      if (affected.size) await this.refreshCounters(tx, [...affected]);
      const creators = [...new Set([...goneLaunches].map((r) => r.creator_address))];
      if (creators.length) await this.refreshCreators(tx, creators);
    });
    // In-memory state above the ancestor is stale.
    this.covered.clear();
    this.curves.clear();
    this.coveredLoaded = false;
    this.ts = new TimestampResolver(this.provider, new DbHeaderStore(this.db, this.chainId));
    log("warn", "indexer.reorg_rolled_back", { network: this.provider.slug, ancestor });
  }

  /** Fail the commit if the block before the range is no longer the one we checkpointed. */
  private async assertCanonical(block: bigint) {
    const stored = await storedBlock(this.db, this.chainId, block);
    if (!stored || !stored.checkpoint) return;
    const h = await canonicalHeader(this.provider, block);
    if (h.hash !== stored.blockHash) throw new ReorgDetectedError(block);
  }

  /** Header for the range end; logs from that block must carry the same hash. */
  private async rangeEndHeader(to: bigint, logs: Log[]) {
    const h = await canonicalHeader(this.provider, to);
    for (const l of logs) if (l.blockNumber === to && l.blockHash && h.hash && l.blockHash !== h.hash) throw new ReorgDetectedError(to);
    return h;
  }

  // ── Launches ─────────────────────────────────────────────────────────────
  async indexLaunches({ adapter, dep }: Pair, head: bigint, activityStart: bigint): Promise<number> {
    const key = this.keys.launches(adapter.id, dep.id);
    let cursor = await getCursor(this.db, key);
    // INDEXER_MIN_START_BLOCK: explicit operator choice to skip older launches (controlled smoke runs,
    // partial deployments). Off by default; /api/health warns while it is set.
    const minStart = envBig("INDEXER_MIN_START_BLOCK");
    const configured = dep.startBlock ?? head;
    const initial = (minStart !== undefined && minStart > configured ? minStart : configured) - 1n;
    let from = (cursor ?? initial) + 1n;
    const span = this.opts.maxLaunchBlocksPerRange ?? (this.provider.logLimits?.singleAddressSpan ?? 1_000_000n) * 4n;
    let total = 0;
    while (from <= head && !this.stop()) {
      const to = from + span - 1n < head ? from + span - 1n : head;
      const logs = await getLogsAdaptive(this.provider, { address: dep.factory, events: adapter.getLaunchEvents(dep) }, from, to, { chunk: this.opts.launchChunk, shouldStop: this.opts.shouldStop }).catch((e) => {
        if (e instanceof StoppedError) return null;
        throw e;
      });
      if (logs === null) break;
      const decoded = logs.map((l) => adapter.decodeLaunch(l, dep)).filter((x): x is DecodedLaunch => !!x);
      if (logs.length !== decoded.length) log("warn", "indexer.undecodable_launch_logs", { network: this.provider.slug, deployment: dep.id, count: logs.length - decoded.length, from, to });
      const meta = await this.fetchTokenMeta(decoded);
      await this.ts.resolve(decoded);
      const header = await this.rangeEndHeader(to, logs);
      if (cursor !== null) await this.assertCanonical(cursor);
      await this.db.transaction(async (tx) => {
        await this.writeLaunches(tx, decoded, meta, activityStart);
        await writeCheckpoint(tx, this.chainId, header);
        await advanceCursor(tx, key, cursor, to);
      });
      for (const d of decoded) if (d.blockNumber >= activityStart) this.track(this.refOf(d));
      if (decoded.length) log("info", "indexer.launches", { network: this.provider.slug, deployment: dep.id, count: decoded.length, from, to });
      this.stats.launchBlocks += to - from + 1n;
      total += decoded.length;
      cursor = to;
      from = to + 1n;
    }
    return total;
  }

  private refOf(d: DecodedLaunch): LaunchRef {
    return { token: lc(d.token), curve: d.curve ? lc(d.curve) : null, creator: lc(d.creator), pair: d.pairCurrency ? lc(d.pairCurrency) : null, createdBlock: d.blockNumber };
  }

  /**
   * ERC-20 reads for new launches, batched through Multicall3. A failure never blocks the launch:
   * the token is stored with null fields and token_meta_status "error" (retried later) or "partial"
   * (the call reverted: e.g. no symbol()), and the event's own name/symbol are kept.
   */
  async fetchTokenMeta(items: DecodedLaunch[]) {
    const out = new Map<string, TokenMeta>();
    if (!items.length) return out;
    let block: bigint | null = null;
    try {
      block = await this.provider.getBlockNumber();
    } catch {
      /* block stays unknown */
    }
    const fns = ["name", "symbol", "decimals", "totalSupply"] as const;
    for (let i = 0; i < items.length; i += 150) {
      const batch = items.slice(i, i + 150);
      let res: Awaited<ReturnType<ChainProvider["multicall"]>> | null = null;
      let failure: string | null = null;
      try {
        res = await this.provider.multicall({ contracts: batch.flatMap((b) => fns.map((functionName) => ({ address: b.token, abi: ERC20_ABI as Abi, functionName }))) });
      } catch (e) {
        failure = errText(e);
      }
      batch.forEach((b, j) => {
        if (!res) return out.set(lc(b.token), { name: b.name, symbol: b.symbol, decimals: null, totalSupply: null, status: "error", error: failure, block: null });
        const r = fns.map((_, k) => res![j * 4 + k]);
        let rpcError: string | null = null;
        const val = (k: number) => {
          const x = r[k];
          if (x?.status === "success") return x.result;
          const info = x?.status === "failure" ? classifyRpcError(x.error) : null;
          if (info && ["rate_limited", "timeout", "transient", "unknown"].includes(info.kind)) rpcError ??= info.message;
          return undefined;
        };
        const name = val(0);
        const symbol = val(1);
        const decimals = val(2);
        const supply = val(3);
        const m: TokenMeta = {
          // The launch event's own name/symbol win when present; the token's view calls fill gaps.
          name: b.name ?? (typeof name === "string" ? displayText(name) : null),
          symbol: b.symbol ?? (typeof symbol === "string" ? displayText(symbol, 64) : null),
          decimals: typeof decimals === "number" ? decimals : null,
          totalSupply: typeof supply === "bigint" ? supply : null,
          status: "ok",
          error: null,
          block,
        };
        const missing = [m.name, m.symbol, m.decimals, m.totalSupply].some((v) => v === null);
        if (rpcError) ((m.status = "error"), (m.error = rpcError));
        else if (missing) ((m.status = "partial"), (m.error = "One or more ERC-20 view calls reverted"));
        out.set(lc(b.token), m);
      });
    }
    return out;
  }

  private async writeLaunches(tx: Tx, decoded: DecodedLaunch[], meta: Map<string, TokenMeta>, activityStart: bigint) {
    const c = this.chainId;
    for (let i = 0; i < decoded.length; i += 500) {
      const b = decoded.slice(i, i + 500);
      await tx
        .insert(tokens)
        .values(
          b.map((d) => {
            const m = meta.get(lc(d.token));
            const covered = d.blockNumber >= activityStart;
            // Counters are only meaningful (0 = "none observed") when full history is covered; otherwise null = unknown.
            const zero = covered ? 0 : null;
            return {
              chainId: c,
              address: lc(d.token),
              name: m?.name ?? d.name,
              symbol: m?.symbol ?? d.symbol,
              decimals: m?.decimals ?? null,
              totalSupply: m?.totalSupply?.toString() ?? null,
              creatorAddress: lc(d.creator),
              createdAt: d.timestamp,
              createdBlock: d.blockNumber,
              createdTx: d.txHash,
              metadataUri: d.metadataURI,
              isVibeLaunch: true,
              launchpad: d.launchpad,
              activityCovered: covered,
              holderCount: zero,
              transferCount: zero,
              buyCount: zero,
              sellCount: zero,
              uniqueBuyers: zero,
              uniqueSellers: zero,
              // Volume is only summed for ETH-quoted curves; other quote currencies stay null ("unavailable").
              volumeWei: covered && (!d.pairCurrency || d.pairCurrency === ZERO_ADDRESS) ? "0" : null,
              tokenMetaStatus: m?.status ?? "error",
              tokenMetaError: m?.error ?? "not fetched",
              tokenMetaBlock: m?.block ?? null,
            };
          }),
        )
        .onConflictDoUpdate({
          target: [tokens.chainId, tokens.address],
          set: {
            isVibeLaunch: true,
            launchpad: sql`excluded.launchpad`,
            creatorAddress: sql`excluded.creator_address`,
            createdAt: sql`excluded.created_at`,
            createdBlock: sql`excluded.created_block`,
            createdTx: sql`excluded.created_tx`,
            metadataUri: sql`excluded.metadata_uri`,
            name: sql`coalesce(excluded.name, ${tokens.name})`,
            symbol: sql`coalesce(excluded.symbol, ${tokens.symbol})`,
            decimals: sql`coalesce(excluded.decimals, ${tokens.decimals})`,
            totalSupply: sql`coalesce(excluded.total_supply, ${tokens.totalSupply})`,
            tokenMetaStatus: sql`case when ${tokens.tokenMetaStatus} = 'ok' then ${tokens.tokenMetaStatus} else excluded.token_meta_status end`,
            tokenMetaError: sql`case when ${tokens.tokenMetaStatus} = 'ok' then null else excluded.token_meta_error end`,
            tokenMetaBlock: sql`coalesce(excluded.token_meta_block, ${tokens.tokenMetaBlock})`,
            updatedAt: new Date(),
          },
        });
      const inserted = await tx
        .insert(launches)
        .values(
          b.map((d) => ({
            chainId: c,
            tokenAddress: lc(d.token),
            creatorAddress: lc(d.creator),
            factoryAddress: lc(d.factory),
            deploymentId: d.deploymentId,
            launchpad: d.launchpad,
            version: d.version,
            eventName: d.eventName,
            launchId: d.launchId.toString(),
            curveAddress: d.curve ? lc(d.curve) : null,
            pairCurrency: d.pairCurrency ? lc(d.pairCurrency) : null,
            txHash: d.txHash,
            blockNumber: d.blockNumber,
            blockHash: d.blockHash,
            logIndex: d.logIndex,
            createdAt: d.timestamp!,
            createdAtExact: d.timestampExact ?? null,
            metadataDigest: d.metadataDigest,
            raw: d.raw,
          })),
        )
        .onConflictDoUpdate({
          target: [launches.chainId, launches.tokenAddress],
          // Same launch replayed: refresh fields added by newer versions; never touch status.
          set: { blockHash: sql`excluded.block_hash`, logIndex: sql`excluded.log_index`, version: sql`excluded.version`, eventName: sql`excluded.event_name`, metadataDigest: sql`excluded.metadata_digest`, createdAtExact: sql`excluded.created_at_exact`, pairCurrency: sql`excluded.pair_currency` },
        })
        .returning({ token: launches.tokenAddress, fresh: sql<boolean>`xmax = 0` });
      const fresh = new Set(inserted.filter((r) => r.fresh).map((r) => r.token));
      const feed = b.filter((d) => fresh.has(lc(d.token)));
      if (feed.length)
        await tx
          .insert(feedEvents)
          .values(feed.map((d) => ({ chainId: c, tokenAddress: lc(d.token), kind: "launch", message: `Launched via ${d.launchpad === "vibe" ? "vibe/vibe" : d.launchpad} ${d.deploymentId} factory`, txHash: d.txHash, blockNumber: d.blockNumber, data: { creator: lc(d.creator), symbol: d.symbol, deployment: d.deploymentId }, createdAt: d.timestamp! })))
          .onConflictDoNothing();
      const withUri = b.filter((d) => d.metadataURI);
      if (withUri.length)
        await tx
          .insert(tokenMetadata)
          .values(withUri.map((d) => ({ chainId: c, tokenAddress: lc(d.token), uri: d.metadataURI!, onchainDigest: d.metadataDigest, priority: d.blockNumber >= activityStart ? 10 : 0 })))
          .onConflictDoNothing();
      const historical = b.filter((d) => d.blockNumber < activityStart);
      if (historical.length && this.historicalBackfillEnabled())
        await tx
          .insert(backfillQueue)
          .values(historical.map((d) => ({ chainId: c, tokenAddress: lc(d.token), status: "pending", reason: "bootstrap", priority: 0, launchBlock: d.blockNumber })))
          .onConflictDoNothing();
    }
    if (decoded.length) await this.refreshCreators(tx, [...new Set(decoded.map((d) => lc(d.creator)))]);
  }

  /** Retry ERC-20 reads that failed at the RPC level (not reverts). */
  async repairTokenMeta(limit: number) {
    if (limit <= 0) return 0;
    const rows = await this.db
      .select({ address: tokens.address, name: tokens.name, symbol: tokens.symbol })
      .from(tokens)
      .where(and(eq(tokens.chainId, this.chainId), eq(tokens.tokenMetaStatus, "error"), sql`${tokens.tokenMetaAttempts} < 10`))
      .limit(limit);
    if (!rows.length) return 0;
    const fake = rows.map((r) => ({ token: getAddress(r.address), name: r.name, symbol: r.symbol }) as DecodedLaunch);
    const meta = await this.fetchTokenMeta(fake);
    for (const r of rows) {
      const m = meta.get(r.address);
      if (!m) continue;
      await this.db
        .update(tokens)
        .set({ name: m.name ?? r.name, symbol: m.symbol ?? r.symbol, decimals: m.decimals, totalSupply: m.totalSupply?.toString() ?? null, tokenMetaStatus: m.status, tokenMetaError: m.error, tokenMetaBlock: m.block, tokenMetaAttempts: sql`${tokens.tokenMetaAttempts} + 1`, updatedAt: new Date() })
        .where(and(eq(tokens.chainId, this.chainId), eq(tokens.address, r.address)));
    }
    return rows.length;
  }

  async refreshCreators(db: Db, addresses: string[]) {
    for (let i = 0; i < addresses.length; i += 1000) {
      const slice = addresses.slice(i, i + 1000);
      await db.execute(sql`
        insert into creators (chain_id, address, first_seen_at, last_seen_at, launch_count, active_launch_count, graduated_launch_count, historical_launch_count)
        select ${this.chainId}, l.creator_address, min(l.created_at), max(l.created_at), count(*),
               count(*) filter (where l.status in ('bonding', 'curve_completed') and t.last_activity_at > now() - interval '7 days'),
               count(*) filter (where l.status = 'graduated'),
               count(*) filter (where l.status in ('bonding', 'curve_completed') and t.activity_covered and (t.last_activity_at is null or t.last_activity_at <= now() - interval '7 days'))
        from launches l left join tokens t on t.chain_id = l.chain_id and t.address = l.token_address
        where l.chain_id = ${this.chainId} and l.creator_address in ${slice}
        group by l.creator_address
        on conflict (chain_id, address) do update set
          first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at, launch_count = excluded.launch_count,
          active_launch_count = excluded.active_launch_count, graduated_launch_count = excluded.graduated_launch_count,
          historical_launch_count = excluded.historical_launch_count`);
    }
  }

  // ── Coverage set ─────────────────────────────────────────────────────────
  private track(r: LaunchRef) {
    this.covered.set(r.token, r);
    if (r.curve) this.curves.set(r.curve, r);
  }

  async loadCovered() {
    if (this.coveredLoaded) return;
    const rows = await this.db
      .select({ token: launches.tokenAddress, curve: launches.curveAddress, creator: launches.creatorAddress, pair: launches.pairCurrency, createdBlock: launches.blockNumber })
      .from(launches)
      .innerJoin(tokens, and(eq(tokens.chainId, launches.chainId), eq(tokens.address, launches.tokenAddress)))
      .where(and(eq(launches.chainId, this.chainId), eq(tokens.activityCovered, true)));
    rows.forEach((r) => this.track(r));
    this.coveredLoaded = true;
    log("info", "indexer.covered_loaded", { network: this.provider.slug, tokens: this.covered.size });
  }

  // ── Live tail ────────────────────────────────────────────────────────────
  /**
   * Activity for every covered token. With few covered tokens the queries are address-filtered
   * (cheap on busy chains); with many, topic-only queries are filtered locally. With none, the
   * cursor advances without log queries.
   */
  async indexTail(head: bigint): Promise<{ through: bigint; events: number }> {
    const key = this.keys.activity;
    const cursor = await getCursor(this.db, key);
    if (cursor === null) return { through: head, events: 0 };
    const from = cursor + 1n;
    if (from > head) return { through: cursor, events: 0 };
    const maxSpan = this.opts.maxTailBlocksPerTick ?? envBig("INDEXER_MAX_TAIL_BLOCKS") ?? 20_000n;
    const to = from + maxSpan - 1n < head ? from + maxSpan - 1n : head;
    const curveEvents = [...new Map(this.adapters.flatMap((a) => a.getCurveEvents()).map((e) => [`${e.name}:${e.inputs.length}`, e])).values()];
    const tokenAddrs = [...this.covered.keys()] as Address[];
    const curveAddrs = [...this.curves.keys()] as Address[];
    const addressMode = tokenAddrs.length <= (envNum("INDEXER_TAIL_ADDRESS_FILTER_MAX") ?? 2_000);
    const opt = { chunk: this.opts.tailChunk, shouldStop: this.opts.shouldStop };
    let transferLogs: Log[];
    let curveLogs: Log[];
    try {
      [transferLogs, curveLogs] = tokenAddrs.length === 0
        ? [[], []]
        : addressMode
          ? await Promise.all([
              getLogsAdaptive(this.provider, { address: tokenAddrs, event: TRANSFER_EVENT }, from, to, opt),
              curveAddrs.length ? getLogsAdaptive(this.provider, { address: curveAddrs, events: curveEvents }, from, to, opt) : Promise.resolve([] as Log[]),
            ])
          : await Promise.all([getLogsAdaptive(this.provider, { event: TRANSFER_EVENT }, from, to, opt), getLogsAdaptive(this.provider, { events: curveEvents }, from, to, opt)]);
    } catch (e) {
      if (e instanceof StoppedError) return { through: cursor, events: 0 };
      throw e;
    }
    const relevantTransfers = transferLogs.filter((l) => this.covered.has(lc(l.address)));
    const relevantCurve = curveLogs.filter((l) => this.curves.has(lc(l.address)));
    const header = await this.rangeEndHeader(to, [...transferLogs, ...curveLogs]);
    await this.assertCanonical(cursor);
    const events = await this.applyLogs(relevantTransfers, relevantCurve, to, async (tx) => {
      await writeCheckpoint(tx, this.chainId, header);
      await advanceCursor(tx, key, cursor, to);
    });
    this.stats.tailBlocks += to - from + 1n;
    log(events ? "info" : "debug", "indexer.activity", { network: this.provider.slug, from, to, mode: tokenAddrs.length === 0 ? "none" : addressMode ? "address" : "topic", scannedTransfers: transferLogs.length, matchedTransfers: relevantTransfers.length, matchedCurve: relevantCurve.length, inserted: events });
    if (Math.random() < 0.05) await pruneCheckpoints(this.db, this.chainId).catch(() => {});
    return { through: to, events };
  }

  // ── Historical backfill (batched, retried, dead-lettered) ───────────────
  async enqueueBackfill(token: string, opts: { reason?: string; priority?: number } = {}) {
    const [l] = await this.db.select({ block: launches.blockNumber }).from(launches).where(and(eq(launches.chainId, this.chainId), eq(launches.tokenAddress, lc(token))));
    await this.db
      .insert(backfillQueue)
      .values({ chainId: this.chainId, tokenAddress: lc(token), status: "pending", reason: opts.reason ?? "manual", priority: opts.priority ?? 100, launchBlock: l?.block ?? null })
      .onConflictDoUpdate({
        target: [backfillQueue.chainId, backfillQueue.tokenAddress],
        set: { priority: sql`greatest(${backfillQueue.priority}, excluded.priority)`, updatedAt: new Date() },
      });
  }

  private workerId() {
    return this.opts.workerId ?? `pid-${process.pid}`;
  }

  /** Atomically claim jobs (SKIP LOCKED + status), so two workers can never process the same token. */
  private async claim(limit: number) {
    const rows = await this.db.execute<{ token_address: string; attempts: number }>(sql`
      update backfill_queue q set status = 'started', started_at = now(), locked_by = ${this.workerId()}, updated_at = now()
      where (q.chain_id, q.token_address) in (
        select chain_id, token_address from backfill_queue
        where chain_id = ${this.chainId}
          and ((status in ('pending', 'failed') and (next_attempt_at is null or next_attempt_at <= now()))
               or (status = 'started' and started_at < now() - interval '15 minutes'))
        order by priority desc, launch_block desc nulls last
        limit ${limit}
        for update skip locked)
      returning q.token_address, q.attempts`);
    return [...rows];
  }

  private async release(tokensLower: string[]) {
    if (!tokensLower.length) return;
    await this.db.update(backfillQueue).set({ status: "pending", lockedBy: null, updatedAt: new Date() }).where(and(eq(backfillQueue.chainId, this.chainId), inArray(backfillQueue.tokenAddress, tokensLower)));
  }

  private async failJob(token: string, attempts: number, e: unknown) {
    const max = this.opts.backfillMaxAttempts ?? 8;
    const n = attempts + 1;
    const dead = n >= max;
    const delayS = Math.min(6 * 3600, 30 * 2 ** (n - 1));
    const msg = errText(e);
    await this.db
      .update(backfillQueue)
      .set({ status: dead ? "dead" : "failed", attempts: n, error: msg, lockedBy: null, nextAttemptAt: dead ? null : new Date(Date.now() + delayS * 1000), updatedAt: new Date() })
      .where(and(eq(backfillQueue.chainId, this.chainId), eq(backfillQueue.tokenAddress, token)));
    log(dead ? "error" : "warn", "indexer.backfill.failed", { network: this.provider.slug, token, attempts: n, dead, retryInS: dead ? null : delayS, error: msg });
  }

  async processBackfillQueue(): Promise<{ done: number; failed: number }> {
    const through = await getCursor(this.db, this.keys.activity);
    if (through === null) return { done: 0, failed: 0 };
    const maxGroup = this.opts.backfillGroupSize ?? envNum("INDEXER_BACKFILL_GROUP") ?? 200;
    const budget = this.opts.backfillPerTick ?? envNum("INDEXER_BACKFILL_PER_TICK") ?? 1_000;
    let group = maxGroup;
    let done = 0;
    let failed = 0;
    while (done + failed < budget && !this.stop()) {
      const jobs = await this.claim(Math.min(group, budget - done - failed));
      if (!jobs.length) break;
      const addrs = jobs.map((j) => j.token_address);
      log("info", "indexer.backfill.started", { network: this.provider.slug, tokens: jobs.length, through });
      try {
        await this.backfillGroup(addrs, through);
        done += jobs.length;
        group = Math.min(maxGroup, group * 2);
      } catch (e) {
        if (e instanceof StoppedError) {
          await this.release(addrs);
          break;
        }
        if (jobs.length > 1) {
          // Isolate a poison token: retry in smaller groups; only single-token failures count as attempts.
          await this.release(addrs);
          group = Math.max(1, Math.floor(jobs.length / 2));
          log("warn", "indexer.backfill.group_split", { network: this.provider.slug, size: jobs.length, next: group, error: errText(e) });
          continue;
        }
        await this.failJob(addrs[0], jobs[0].attempts, e);
        failed++;
      }
    }
    return { done, failed };
  }

  /** @deprecated single-token entry point kept for callers/tests; uses the batched path. */
  async backfillToken(tokenLower: string, through: bigint) {
    await this.backfillGroup([lc(tokenLower)], through);
  }

  /**
   * Complete history [launch block, through] for a group of tokens with two multi-address log
   * queries, committed atomically with the tokens' coverage. `through` must still be the activity
   * cursor at commit time (the tail continues from there), otherwise the group is retried.
   */
  async backfillGroup(tokensLower: string[], through: bigint) {
    const c = this.chainId;
    const ls = await this.db.select().from(launches).where(and(eq(launches.chainId, c), inArray(launches.tokenAddress, tokensLower)));
    const known = new Map(ls.map((l) => [l.tokenAddress, l]));
    const unknown = tokensLower.filter((t) => !known.has(t));
    if (unknown.length) {
      // Permanent: only indexed launches can be backfilled (bounds what a request can make us fetch).
      await this.db.update(backfillQueue).set({ status: "dead", error: "Not a known launch on this chain", lockedBy: null, updatedAt: new Date() }).where(and(eq(backfillQueue.chainId, c), inArray(backfillQueue.tokenAddress, unknown)));
      log("warn", "indexer.backfill.failed", { network: this.provider.slug, tokens: unknown, dead: true, error: "not a known launch" });
      if (!known.size) return;
    }
    const covered = new Set(
      (await this.db.select({ a: tokens.address }).from(tokens).where(and(eq(tokens.chainId, c), inArray(tokens.address, [...known.keys()]), eq(tokens.activityCovered, true)))).map((r) => r.a),
    );
    const todo = [...known.values()].filter((l) => !covered.has(l.tokenAddress) && l.blockNumber <= through);
    const later = [...known.values()].filter((l) => l.blockNumber > through).map((l) => l.tokenAddress);
    const finish = async (tx: Tx, addrs: string[]) => {
      if (!addrs.length) return;
      await tx.update(backfillQueue).set({ status: "completed", doneAt: new Date(), throughBlock: through, error: null, lockedBy: null, updatedAt: new Date() }).where(and(eq(backfillQueue.chainId, c), inArray(backfillQueue.tokenAddress, addrs)));
    };
    if (!todo.length) {
      await this.db.transaction(async (tx) => {
        await finish(tx, [...covered]);
        // Launched after the cursor: the tail will cover it; nothing to backfill yet.
        if (later.length) await tx.update(backfillQueue).set({ status: "pending", nextAttemptAt: new Date(Date.now() + 60_000), lockedBy: null }).where(and(eq(backfillQueue.chainId, c), inArray(backfillQueue.tokenAddress, later)));
      });
      return;
    }
    const minBlock = todo.reduce((m, l) => (l.blockNumber < m ? l.blockNumber : m), todo[0].blockNumber);
    const tokenAddrs = todo.map((l) => getAddress(l.tokenAddress));
    const curveAddrs = todo.filter((l) => l.curveAddress).map((l) => getAddress(l.curveAddress!));
    const curveEvents = [...new Map(this.adapters.flatMap((a) => a.getCurveEvents()).map((e) => [`${e.name}:${e.inputs.length}`, e])).values()];
    const opt = { shouldStop: this.opts.shouldStop };
    const [transferLogs, curveLogs] = await Promise.all([
      getLogsAdaptive(this.provider, { address: tokenAddrs, event: TRANSFER_EVENT }, minBlock, through, opt),
      curveAddrs.length ? getLogsAdaptive(this.provider, { address: curveAddrs, events: curveEvents }, minBlock, through, opt) : Promise.resolve([] as Log[]),
    ]);
    const launchBlock = new Map(todo.map((l) => [l.tokenAddress, l.blockNumber]));
    const curveToken = new Map(todo.filter((l) => l.curveAddress).map((l) => [l.curveAddress!, l.tokenAddress]));
    // Nothing a token or its curve emitted can predate its launch block.
    const tf = transferLogs.filter((l) => l.blockNumber! >= (launchBlock.get(lc(l.address)) ?? 0n));
    const cl = curveLogs.filter((l) => l.blockNumber! >= (launchBlock.get(curveToken.get(lc(l.address)) ?? "") ?? 0n));
    for (const l of todo) this.track({ token: l.tokenAddress, curve: l.curveAddress, creator: l.creatorAddress, pair: l.pairCurrency, createdBlock: l.blockNumber });
    const addrs = todo.map((l) => l.tokenAddress);
    try {
      await this.applyLogs(
        tf,
        cl,
        through,
        async (tx) => {
          const cur = await lockCursor(tx, this.keys.activity);
          if (cur !== through) throw new Error(`activity cursor moved (${through} → ${cur}); backfill will be retried`);
          const eth = todo.filter((l) => !l.pairCurrency || l.pairCurrency === ZERO_ADDRESS).map((l) => l.tokenAddress);
          await tx.update(tokens).set({ activityCovered: true }).where(and(eq(tokens.chainId, c), inArray(tokens.address, addrs)));
          if (eth.length) await tx.update(tokens).set({ volumeWei: sql`coalesce(${tokens.volumeWei}, 0)` }).where(and(eq(tokens.chainId, c), inArray(tokens.address, eth)));
          await this.recomputeLaunchStatus(tx, addrs);
          await finish(tx, [...addrs, ...covered]);
        },
        addrs,
      );
    } catch (e) {
      for (const a of addrs) {
        this.covered.delete(a);
        const curve = known.get(a)?.curveAddress;
        if (curve) this.curves.delete(curve);
      }
      throw e;
    }
    log("info", "indexer.backfill.completed", { network: this.provider.slug, tokens: addrs.length, transfers: tf.length, curveEvents: cl.length, from: minBlock, through });
  }

  // ── Shared write path ────────────────────────────────────────────────────
  private async applyHolderDeltas(tx: Tx, entries: [string, bigint][]) {
    const now = new Date();
    const nz = entries.filter(([, v]) => v !== 0n);
    for (let i = 0; i < nz.length; i += 1000) {
      await tx
        .insert(holders)
        .values(
          nz.slice(i, i + 1000).map(([k, v]) => {
            const [token, wallet] = k.split(":");
            return { chainId: this.chainId, tokenAddress: token, walletAddress: wallet, balance: v.toString(), firstSeenAt: now, lastUpdatedAt: now };
          }),
        )
        .onConflictDoUpdate({ target: [holders.chainId, holders.tokenAddress, holders.walletAddress], set: { balance: sql`${holders.balance} + excluded.balance`, lastUpdatedAt: now } });
    }
  }

  /** Re-derive launch status from stored graduation events (used after backfills and reorg rollbacks). */
  async recomputeLaunchStatus(db: Db, tokenAddrs: string[]) {
    for (let i = 0; i < tokenAddrs.length; i += 1000) {
      const slice = tokenAddrs.slice(i, i + 1000);
      await db.execute(sql`
        update launches l set
          status = case when g.tx_hash is not null then 'graduated' when cc.at is not null then 'curve_completed' else 'bonding' end,
          graduated_at = g.timestamp, graduated_tx = g.tx_hash, graduated_block = g.block_number, curve_completed_at = cc.at
        from (select unnest(array[${sql.join(slice.map((a) => sql`${a}`), sql`, `)}]::varchar[]) as address) s
        left join lateral (select tx_hash, block_number, timestamp from transaction_events e
                           where e.chain_id = ${this.chainId} and e.token_address = s.address and e.event_type = 'graduation'
                           order by block_number, log_index limit 1) g on true
        left join lateral (select min(timestamp) as at from transaction_events e
                           where e.chain_id = ${this.chainId} and e.token_address = s.address and e.event_type = 'curve_completed') cc on true
        where l.chain_id = ${this.chainId} and l.token_address = s.address
          and exists (select 1 from tokens t where t.chain_id = l.chain_id and t.address = l.token_address and t.activity_covered)`);
    }
  }

  private async applyLogs(transferLogs: Log[], curveLogs: Log[], head: bigint, finalize: (tx: Tx) => Promise<void>, alwaysRefresh: string[] = []): Promise<number> {
    const transfers = transferLogs.map(decodeTransfer).filter((x): x is DecodedTransfer => !!x);
    const trades: DecodedTrade[] = [];
    const grads: DecodedGraduation[] = [];
    for (const l of curveLogs) {
      for (const a of this.adapters) {
        const t = a.decodeTrade(l);
        if (t) {
          trades.push(t);
          break;
        }
        const g = a.decodeGraduation(l);
        if (g) {
          grads.push(g);
          break;
        }
      }
    }
    await this.ts.resolve([...transfers, ...trades, ...grads], head);
    const touched = new Set<string>(alwaysRefresh);
    let inserted = 0;
    const c = this.chainId;

    await this.db.transaction(async (tx) => {
      // Transfers → events → holder deltas (only for rows inserted now).
      const fresh: DecodedTransfer[] = [];
      for (let i = 0; i < transfers.length; i += 1000) {
        const slice = transfers.slice(i, i + 1000);
        const rows = await tx
          .insert(transactionEvents)
          .values(slice.map((t) => ({ chainId: c, txHash: t.txHash, logIndex: t.logIndex, blockNumber: t.blockNumber, blockHash: t.blockHash ?? null, timestamp: t.timestamp!, timestampExact: t.timestampExact ?? null, tokenAddress: lc(t.token), walletAddress: lc(t.to), counterparty: lc(t.from), eventType: "transfer", eventName: "Transfer", amount: t.value.toString() })))
          .onConflictDoNothing()
          .returning({ txHash: transactionEvents.txHash, logIndex: transactionEvents.logIndex });
        const ok = new Set(rows.map((r) => `${r.txHash}:${r.logIndex}`));
        fresh.push(...slice.filter((t) => ok.has(`${t.txHash}:${t.logIndex}`)));
      }
      inserted += fresh.length;
      await this.applyHolderDeltas(tx, [...balanceDeltas(fresh).entries()]);
      for (const t of fresh) touched.add(lc(t.token));

      // Curve trades.
      const tradeRows = trades.flatMap((tr) => {
        const ref = this.curves.get(lc(tr.curve));
        return ref ? [{ tr, ref }] : [];
      });
      for (let i = 0; i < tradeRows.length; i += 1000) {
        const slice = tradeRows.slice(i, i + 1000);
        const rows = await tx
          .insert(transactionEvents)
          .values(slice.map(({ tr, ref }) => ({ chainId: c, txHash: tr.txHash, logIndex: tr.logIndex, blockNumber: tr.blockNumber, blockHash: tr.blockHash, timestamp: tr.timestamp!, timestampExact: tr.timestampExact ?? null, tokenAddress: ref.token, walletAddress: lc(tr.trader), counterparty: lc(tr.curve), eventType: tr.kind, eventName: tr.eventName, amount: tr.tokenAmount.toString(), quoteAmount: tr.quoteAmount.toString() })))
          .onConflictDoNothing()
          .returning({ txHash: transactionEvents.txHash, logIndex: transactionEvents.logIndex });
        const ok = new Set(rows.map((r) => `${r.txHash}:${r.logIndex}`));
        const freshTrades = slice.filter(({ tr }) => ok.has(`${tr.txHash}:${tr.logIndex}`));
        inserted += freshTrades.length;
        for (const { ref } of freshTrades) touched.add(ref.token);
        const byCreator = freshTrades.filter(({ tr, ref }) => ref.creator === lc(tr.trader));
        if (byCreator.length)
          await tx
            .insert(feedEvents)
            .values(byCreator.map(({ tr, ref }) => ({ chainId: c, tokenAddress: ref.token, kind: "creator_activity", message: `Creator wallet ${tr.kind === "buy" ? "bought" : "sold"} on the bonding curve`, txHash: tr.txHash, blockNumber: tr.blockNumber, data: { side: tr.kind, amount: tr.tokenAmount.toString(), quote: tr.quoteAmount.toString() }, createdAt: tr.timestamp! })))
            .onConflictDoNothing();
      }

      // Graduations / curve completions: stored as events (replayable, reorg-reversible), status only from fresh rows.
      for (const g of grads) {
        const ref = this.curves.get(lc(g.curve));
        if (!ref) continue;
        const rows = await tx
          .insert(transactionEvents)
          .values({ chainId: c, txHash: g.txHash, logIndex: g.logIndex, blockNumber: g.blockNumber, blockHash: g.blockHash, timestamp: g.timestamp!, timestampExact: g.timestampExact ?? null, tokenAddress: ref.token, walletAddress: null, counterparty: lc(g.curve), eventType: g.kind === "graduated" ? "graduation" : "curve_completed", eventName: g.eventName, amount: g.tokenAmount?.toString() ?? null, quoteAmount: g.quoteAmount?.toString() ?? null })
          .onConflictDoNothing()
          .returning({ id: transactionEvents.id });
        if (!rows.length) continue;
        inserted++;
        touched.add(ref.token);
        if (g.kind === "graduated") {
          await tx
            .update(launches)
            .set({ status: "graduated", graduatedAt: g.timestamp, graduatedTx: g.txHash, graduatedBlock: g.blockNumber })
            .where(and(eq(launches.chainId, c), eq(launches.tokenAddress, ref.token), sql`(${launches.graduatedBlock} is null or ${launches.graduatedBlock} > ${g.blockNumber})`));
          await tx.insert(feedEvents).values({ chainId: c, tokenAddress: ref.token, kind: "graduation", message: "Graduation event observed on the bonding curve", txHash: g.txHash, blockNumber: g.blockNumber, data: { event: g.eventName, poolId: g.poolId }, createdAt: g.timestamp! }).onConflictDoNothing();
        } else {
          await tx
            .update(launches)
            .set({ status: sql`case when ${launches.status} = 'graduated' then 'graduated' else 'curve_completed' end`, curveCompletedAt: sql`coalesce(${launches.curveCompletedAt}, ${g.timestamp!.toISOString()}::timestamptz)` })
            .where(and(eq(launches.chainId, c), eq(launches.tokenAddress, ref.token)));
          await tx.insert(feedEvents).values({ chainId: c, tokenAddress: ref.token, kind: "curve_completed", message: "Bonding curve reached its target (CurveCompleted); graduation is a separate event", txHash: g.txHash, blockNumber: g.blockNumber, data: { event: g.eventName }, createdAt: g.timestamp! }).onConflictDoNothing();
        }
      }

      await finalize(tx);
      if (touched.size) await this.refreshCounters(tx, [...touched]);
    });

    if (touched.size) {
      await this.snapshot([...touched], head);
      const creators = [...new Set([...touched].map((t) => this.covered.get(t)?.creator).filter((x): x is string => !!x))];
      await this.refreshCreators(this.db, creators);
    }
    return inserted;
  }

  async refreshCounters(db: Db, tokenAddrs: string[]) {
    const c = this.chainId;
    const excluded = [...DEAD_ADDRESSES, ...this.adapters.flatMap((a) => a.protocolExclusions().map((x) => x.address))];
    for (let i = 0; i < tokenAddrs.length; i += 500) {
      const slice = tokenAddrs.slice(i, i + 500);
      await db.execute(sql`
        update tokens t set
          holder_count = coalesce(h.cnt, 0),
          transfer_count = coalesce(e.transfers, 0),
          buy_count = coalesce(e.buys, 0),
          sell_count = coalesce(e.sells, 0),
          unique_buyers = coalesce(e.buyers, 0),
          unique_sellers = coalesce(e.sellers, 0),
          volume_wei = case when t.volume_wei is null then null else coalesce(e.vol, 0) end,
          last_activity_at = e.last_at,
          updated_at = now()
        from (select unnest(array[${sql.join(slice.map((a) => sql`${a}`), sql`, `)}]::varchar[]) as address) s
        left join lateral (
          select count(*) as cnt from holders h
          where h.chain_id = ${c} and h.token_address = s.address and h.balance > 0
            and h.wallet_address not in ${excluded}
            and h.wallet_address <> s.address
            and h.wallet_address not in (select curve_address from launches where chain_id = ${c} and token_address = s.address and curve_address is not null)
        ) h on true
        left join lateral (
          select count(*) filter (where event_type = 'transfer') as transfers,
                 count(*) filter (where event_type = 'buy') as buys,
                 count(*) filter (where event_type = 'sell') as sells,
                 count(distinct wallet_address) filter (where event_type = 'buy') as buyers,
                 count(distinct wallet_address) filter (where event_type = 'sell') as sellers,
                 sum(quote_amount) filter (where event_type in ('buy','sell')) as vol,
                 max(timestamp) filter (where event_type in ('transfer','buy','sell')) as last_at
          from transaction_events where chain_id = ${c} and token_address = s.address
        ) e on true
        where t.chain_id = ${c} and t.address = s.address and t.activity_covered`);
    }
  }

  async snapshot(tokenAddrs: string[], block: bigint) {
    const every = this.opts.snapshotEveryMs ?? 10 * 60_000;
    for (let i = 0; i < tokenAddrs.length; i += 500) {
      const slice = tokenAddrs.slice(i, i + 500);
      const rows = await this.db.select().from(tokens).where(and(eq(tokens.chainId, this.chainId), inArray(tokens.address, slice), eq(tokens.activityCovered, true)));
      if (!rows.length) continue;
      const last = await this.db.execute<{ token_address: string; ts: Date }>(sql`
        select token_address, max(timestamp) as ts from activity_snapshots
        where chain_id = ${this.chainId} and token_address in ${slice} group by token_address`);
      const lastMap = new Map([...last].map((r) => [r.token_address, new Date(r.ts).getTime()]));
      const now = Date.now();
      const due = rows.filter((r) => now - (lastMap.get(r.address) ?? 0) >= every);
      if (!due.length) continue;
      await this.db.insert(activitySnapshots).values(
        due.map((r) => ({ chainId: this.chainId, tokenAddress: r.address, timestamp: new Date(now), blockNumber: block, holders: r.holderCount, transactions: r.transferCount, buyers: r.uniqueBuyers, sellers: r.uniqueSellers, volume: r.volumeWei })),
      );
    }
  }

  // ── Contract analysis of new launches (cached; bounded per tick) ─────────
  async analyzeNewLaunches(limit: number) {
    if (limit <= 0) return 0;
    const rows = await this.db
      .select({ address: tokens.address })
      .from(tokens)
      .where(and(eq(tokens.chainId, this.chainId), eq(tokens.isVibeLaunch, true), sql`${tokens.analyzedAt} is null`, sql`${tokens.createdAt} > now() - interval '3 days'`))
      .orderBy(sql`${tokens.createdBlock} desc nulls last`)
      .limit(limit);
    if (!rows.length) return 0;
    const { getContractAnalysis } = await import("../lib/services/token-service");
    let n = 0;
    for (const r of rows) {
      if (this.stop()) break;
      try {
        await getContractAnalysis(getAddress(r.address), { network: this.provider.slug, provider: this.provider });
        n++;
      } catch (e) {
        log("warn", "indexer.analysis_failed", { network: this.provider.slug, token: r.address, error: errText(e) });
      }
    }
    return n;
  }
}

export { CursorConflictError } from "./state";

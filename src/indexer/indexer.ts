import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getAddress, toEventSelector, type Abi, type Log } from "viem";
import type { ChainProvider } from "../lib/chain/provider";
import { getLogsChunked } from "../lib/chain/provider";
import type { DB } from "../lib/db/client";
import { schema } from "../lib/db/client";
import { ERC20_ABI, TRANSFER_EVENT, VIBE_EVENTS } from "../lib/vibe/abis";
import { PROTOCOL_HOLDER_EXCLUSIONS, VIBE_DEPLOYMENTS, type VibeDeployment } from "../lib/vibe/contracts";
import { log } from "../lib/util/log";
import { DEAD_ADDRESSES, ZERO_ADDRESS } from "../lib/util/address";
import { balanceDeltas, decodeLaunch, decodeTrade, decodeTransfer, type DecodedLaunch, type DecodedTrade, type DecodedTransfer } from "./decode";
import { TimestampResolver } from "./timestamps";

const { tokens, launches, holders, transactionEvents, indexerState, activitySnapshots, feedEvents, backfillQueue } = schema;

export type IndexerOptions = {
  /** Block span per factory log request (launch events are sparse). */
  launchChunk?: bigint;
  /** Block span per unfiltered topic request in the live tail (halved automatically on the 10k-log limit). */
  tailChunk?: bigint;
  /** Max blocks the tail advances per tick, so launches/backfills interleave. */
  maxTailBlocksPerTick?: bigint;
  /** How far behind head the activity tail starts on first run (tokens launched earlier are backfilled on demand). */
  initialBackfillBlocks?: bigint;
  backfillPerTick?: number;
  snapshotEveryMs?: number;
  shouldStop?: () => boolean;
};

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type LaunchRef = { token: string; curve: string | null; creator: string; pair: string | null };

const lc = (a: string) => a.toLowerCase();
const CURVE_EVENTS = [VIBE_EVENTS.CurveBuy, VIBE_EVENTS.CurveSell, VIBE_EVENTS.Bought, VIBE_EVENTS.Sold, VIBE_EVENTS.Graduated, VIBE_EVENTS.GraduatedV6, VIBE_EVENTS.CurveCompleted];
const GRADUATION_TOPICS = new Set<string>([VIBE_EVENTS.Graduated, VIBE_EVENTS.GraduatedV6, VIBE_EVENTS.CurveCompleted].map((e) => toEventSelector(e as never)));

async function getCursor(db: DB | Tx, key: string): Promise<bigint | null> {
  const [row] = await db.select().from(indexerState).where(eq(indexerState.key, key));
  return row?.lastBlock ?? null;
}

async function setCursor(db: DB | Tx, key: string, block: bigint) {
  await db.insert(indexerState).values({ key, lastBlock: block }).onConflictDoUpdate({ target: indexerState.key, set: { lastBlock: block, updatedAt: new Date() } });
}

export class VibeIndexer {
  private ts: TimestampResolver;
  /** Covered tokens / curves, kept in memory for local filtering of unfiltered log queries. */
  private covered = new Map<string, LaunchRef>();
  private curves = new Map<string, LaunchRef>();
  private coveredLoaded = false;

  constructor(
    private provider: ChainProvider,
    private db: DB,
    private opts: IndexerOptions = {},
    private deployments: VibeDeployment[] = VIBE_DEPLOYMENTS,
  ) {
    this.ts = new TimestampResolver(provider);
  }

  get chainId() {
    return this.provider.chainId;
  }
  keys() {
    return { activity: `activity:${this.chainId}`, activityStart: `activity_start:${this.chainId}`, launches: (id: string) => `launches:${this.chainId}:${id}` };
  }

  async tick() {
    const head = await this.provider.getBlockNumber();
    const start = await this.ensureActivityStart(head);
    let newLaunches = 0;
    for (const dep of this.deployments) newLaunches += await this.indexLaunches(dep, head, start);
    // The tail must never pass a block whose launches are not indexed yet: a token launched there
    // would be marked covered while its early events were skipped. Clamp to the slowest launch cursor.
    let launchesThrough = head;
    for (const dep of this.deployments) {
      const c = await getCursor(this.db, this.keys().launches(dep.id));
      if (c !== null && c < launchesThrough) launchesThrough = c;
    }
    if (this.opts.shouldStop?.()) {
      const through = (await getCursor(this.db, this.keys().activity)) ?? start - 1n;
      return { head, activityThrough: through, newLaunches, newEvents: 0, backfilled: 0 };
    }
    await this.loadCovered();
    const { through, events } = await this.indexTail(launchesThrough);
    const backfilled = this.opts.shouldStop?.() ? 0 : await this.processBackfillQueue(this.opts.backfillPerTick ?? 10);
    return { head, activityThrough: through, newLaunches, newEvents: events, backfilled };
  }

  async ensureActivityStart(head: bigint): Promise<bigint> {
    const k = this.keys().activityStart;
    const existing = await getCursor(this.db, k);
    if (existing !== null) return existing;
    const env = process.env.INDEXER_ACTIVITY_START ? BigInt(process.env.INDEXER_ACTIVITY_START) : null;
    const start = env ?? head - (this.opts.initialBackfillBlocks ?? 100_000n);
    await setCursor(this.db, k, start);
    await setCursor(this.db, this.keys().activity, start - 1n);
    // Launches already indexed at/after the start are fully covered by the tail.
    await this.db.update(tokens).set({ activityCovered: true, holderCount: 0, transferCount: 0, buyCount: 0, sellCount: 0, uniqueBuyers: 0, uniqueSellers: 0 }).where(and(eq(tokens.chainId, this.chainId), sql`${tokens.createdBlock} >= ${start}`));
    log("info", "indexer.activity_start", { start });
    return start;
  }

  // ── Launches ───────────────────────────────────────────────────────────────
  async indexLaunches(dep: VibeDeployment, head: bigint, activityStart: bigint): Promise<number> {
    const key = this.keys().launches(dep.id);
    let from = ((await getCursor(this.db, key)) ?? (dep.deployBlock ?? head) - 1n) + 1n;
    const event = dep.launchEvent === "LaunchCreated" ? VIBE_EVENTS.LaunchCreated : VIBE_EVENTS.TokenLaunched;
    const span = this.opts.launchChunk ?? 1_000_000n;
    let total = 0;
    while (from <= head && !this.opts.shouldStop?.()) {
      const to = from + span - 1n < head ? from + span - 1n : head;
      const logs = await getLogsChunked(this.provider, { address: dep.factory, event }, from, to, span);
      const decoded = logs.map((l) => decodeLaunch(l, dep)).filter((x): x is DecodedLaunch => !!x);
      if (logs.length !== decoded.length) log("warn", "indexer.undecodable_launch_logs", { deployment: dep.id, count: logs.length - decoded.length });
      const needMeta = decoded.filter((d) => d.symbol === null);
      if (needMeta.length) await this.fillTokenMeta(needMeta);
      await this.ts.resolve(decoded, head);
      await this.db.transaction(async (tx) => {
        await this.writeLaunches(tx, decoded, activityStart);
        await setCursor(tx, key, to);
      });
      for (const d of decoded) if (d.blockNumber >= activityStart) this.track({ token: lc(d.token), curve: lc(d.curve), creator: lc(d.creator), pair: d.pairCurrency ? lc(d.pairCurrency) : null });
      if (decoded.length) log("info", "indexer.launches", { deployment: dep.id, count: decoded.length, from, to });
      total += decoded.length;
      from = to + 1n;
    }
    return total;
  }

  private async writeLaunches(tx: Tx, decoded: DecodedLaunch[], activityStart: bigint) {
    for (let i = 0; i < decoded.length; i += 500) {
      const b = decoded.slice(i, i + 500);
      await tx
        .insert(tokens)
        .values(
          b.map((d) => {
            const covered = d.blockNumber >= activityStart;
            // Counters are only meaningful (0 = "none observed") when full history is covered; otherwise null = unknown.
            const zero = covered ? 0 : null;
            return {
              chainId: this.chainId,
              address: lc(d.token),
              name: d.name,
              symbol: d.symbol,
              creatorAddress: lc(d.creator),
              createdAt: d.timestamp,
              createdBlock: d.blockNumber,
              createdTx: d.txHash,
              metadataUri: d.metadataURI,
              isVibeLaunch: true,
              activityCovered: covered,
              holderCount: zero,
              transferCount: zero,
              buyCount: zero,
              sellCount: zero,
              uniqueBuyers: zero,
              uniqueSellers: zero,
              // Volume only summed for ETH-paired curves; other pairs stay null ("unavailable").
              volumeWei: covered && (!d.pairCurrency || d.pairCurrency === ZERO_ADDRESS) ? "0" : null,
            };
          }),
        )
        .onConflictDoUpdate({
          target: [tokens.chainId, tokens.address],
          set: {
            isVibeLaunch: true,
            creatorAddress: sql`excluded.creator_address`,
            createdAt: sql`excluded.created_at`,
            createdBlock: sql`excluded.created_block`,
            createdTx: sql`excluded.created_tx`,
            metadataUri: sql`excluded.metadata_uri`,
            name: sql`coalesce(${tokens.name}, excluded.name)`,
            symbol: sql`coalesce(${tokens.symbol}, excluded.symbol)`,
            updatedAt: new Date(),
          },
        });
      const inserted = await tx
        .insert(launches)
        .values(
          b.map((d) => ({
            chainId: this.chainId,
            tokenAddress: lc(d.token),
            creatorAddress: lc(d.creator),
            factoryAddress: lc(d.factory),
            deploymentId: d.deploymentId,
            launchId: d.launchId.toString(),
            curveAddress: lc(d.curve),
            pairCurrency: d.pairCurrency ? lc(d.pairCurrency) : null,
            txHash: d.txHash,
            blockNumber: d.blockNumber,
            createdAt: d.timestamp ?? new Date(),
            raw: d.raw,
          })),
        )
        .onConflictDoNothing()
        .returning({ token: launches.tokenAddress });
      const fresh = new Set(inserted.map((r) => r.token));
      const feed = b.filter((d) => fresh.has(lc(d.token)));
      if (feed.length)
        await tx
          .insert(feedEvents)
          .values(feed.map((d) => ({ chainId: this.chainId, tokenAddress: lc(d.token), kind: "launch", message: `Launched via vibe/vibe ${d.deploymentId} factory`, txHash: d.txHash, data: { creator: d.creator, symbol: d.symbol }, createdAt: d.timestamp ?? new Date() })))
          .onConflictDoNothing();
    }
    if (decoded.length) await this.refreshCreators(tx, [...new Set(decoded.map((d) => lc(d.creator)))]);
  }

  private async fillTokenMeta(items: DecodedLaunch[]) {
    for (let i = 0; i < items.length; i += 200) {
      const batch = items.slice(i, i + 200);
      const res = await this.provider.multicall({
        contracts: batch.flatMap((b) => [
          { address: b.token, abi: ERC20_ABI as Abi, functionName: "name" },
          { address: b.token, abi: ERC20_ABI as Abi, functionName: "symbol" },
        ]),
      });
      batch.forEach((b, j) => {
        const n = res[j * 2];
        const s = res[j * 2 + 1];
        b.name = n?.status === "success" ? String(n.result) : null;
        b.symbol = s?.status === "success" ? String(s.result) : null;
      });
    }
  }

  async refreshCreators(db: DB | Tx, addresses: string[]) {
    for (let i = 0; i < addresses.length; i += 1000) {
      const slice = addresses.slice(i, i + 1000);
      await db.execute(sql`
        insert into creators (chain_id, address, first_seen_at, last_seen_at, launch_count, active_launch_count, graduated_launch_count, historical_launch_count)
        select ${this.chainId}, l.creator_address, min(l.created_at), max(l.created_at), count(*),
               count(*) filter (where l.status = 'bonding' and t.last_activity_at > now() - interval '7 days'),
               count(*) filter (where l.status = 'graduated'),
               count(*) filter (where l.status = 'bonding' and (t.last_activity_at is null or t.last_activity_at <= now() - interval '7 days'))
        from launches l left join tokens t on t.chain_id = l.chain_id and t.address = l.token_address
        where l.chain_id = ${this.chainId} and l.creator_address in ${slice}
        group by l.creator_address
        on conflict (chain_id, address) do update set
          first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at, launch_count = excluded.launch_count,
          active_launch_count = excluded.active_launch_count, graduated_launch_count = excluded.graduated_launch_count,
          historical_launch_count = excluded.historical_launch_count`);
    }
  }

  // ── Coverage set ───────────────────────────────────────────────────────────
  private track(r: LaunchRef) {
    this.covered.set(r.token, r);
    if (r.curve) this.curves.set(r.curve, r);
  }

  async loadCovered() {
    if (this.coveredLoaded) return;
    const rows = await this.db
      .select({ token: launches.tokenAddress, curve: launches.curveAddress, creator: launches.creatorAddress, pair: launches.pairCurrency })
      .from(launches)
      .innerJoin(tokens, and(eq(tokens.chainId, launches.chainId), eq(tokens.address, launches.tokenAddress)))
      .where(and(eq(launches.chainId, this.chainId), eq(tokens.activityCovered, true)));
    rows.forEach((r) => this.track(r));
    this.coveredLoaded = true;
    log("info", "indexer.covered_loaded", { tokens: this.covered.size });
  }

  // ── Live tail: unfiltered topic queries, filtered locally ─────────────────
  async indexTail(head: bigint): Promise<{ through: bigint; events: number }> {
    const key = this.keys().activity;
    const from = ((await getCursor(this.db, key)) ?? head - 1n) + 1n;
    if (from > head) return { through: head, events: 0 };
    const maxSpan = this.opts.maxTailBlocksPerTick ?? 20_000n;
    const to = from + maxSpan - 1n < head ? from + maxSpan - 1n : head;
    const chunk = this.opts.tailChunk ?? 5_000n;

    const [transferLogs, curveLogs] = await Promise.all([
      getLogsChunked(this.provider, { event: TRANSFER_EVENT }, from, to, chunk),
      getLogsChunked(this.provider, { events: CURVE_EVENTS }, from, to, chunk),
    ]);
    const relevantTransfers = transferLogs.filter((l) => this.covered.has(lc(l.address)));
    const relevantCurve = curveLogs.filter((l) => this.curves.has(lc(l.address)));
    const events = await this.applyLogs(relevantTransfers, relevantCurve, head, (tx) => setCursor(tx, key, to));
    log("info", "indexer.tail", { from, to, scannedTransfers: transferLogs.length, matchedTransfers: relevantTransfers.length, matchedCurve: relevantCurve.length });
    return { through: to, events };
  }

  // ── Per-token backfill (complete history from launch block) ───────────────
  async enqueueBackfill(token: string) {
    await this.db.insert(backfillQueue).values({ chainId: this.chainId, tokenAddress: lc(token) }).onConflictDoNothing();
  }

  async processBackfillQueue(limit: number): Promise<number> {
    const through = await getCursor(this.db, this.keys().activity);
    if (through === null) return 0;
    const queue = await this.db.select().from(backfillQueue).where(and(eq(backfillQueue.chainId, this.chainId), isNull(backfillQueue.doneAt))).orderBy(asc(backfillQueue.requestedAt)).limit(limit);
    let done = 0;
    for (const q of queue) {
      if (this.opts.shouldStop?.()) break;
      try {
        await this.backfillToken(q.tokenAddress, through);
        await this.db.update(backfillQueue).set({ doneAt: new Date(), error: null }).where(and(eq(backfillQueue.chainId, this.chainId), eq(backfillQueue.tokenAddress, q.tokenAddress)));
        done++;
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 300) : String(e);
        await this.db.update(backfillQueue).set({ startedAt: new Date(), error: msg }).where(and(eq(backfillQueue.chainId, this.chainId), eq(backfillQueue.tokenAddress, q.tokenAddress)));
        log("warn", "indexer.backfill_failed", { token: q.tokenAddress, error: msg });
      }
    }
    return done;
  }

  async backfillToken(tokenLower: string, through: bigint) {
    const [l] = await this.db.select().from(launches).where(and(eq(launches.chainId, this.chainId), eq(launches.tokenAddress, tokenLower)));
    if (!l) throw new Error("not a known vibe/vibe launch");
    const [t] = await this.db.select({ covered: tokens.activityCovered }).from(tokens).where(and(eq(tokens.chainId, this.chainId), eq(tokens.address, tokenLower)));
    if (t?.covered) return;
    const ref: LaunchRef = { token: l.tokenAddress, curve: l.curveAddress, creator: l.creatorAddress, pair: l.pairCurrency };
    const [transferLogs, curveLogs] = await Promise.all([
      getLogsChunked(this.provider, { address: getAddress(tokenLower), event: TRANSFER_EVENT }, l.blockNumber, through, 2_000_000n),
      l.curveAddress ? getLogsChunked(this.provider, { address: getAddress(l.curveAddress), events: CURVE_EVENTS }, l.blockNumber, through, 2_000_000n) : Promise.resolve([] as Log[]),
    ]);
    this.track(ref);
    const pairIsEth = !l.pairCurrency || l.pairCurrency === ZERO_ADDRESS;
    await this.applyLogs(transferLogs, curveLogs, through, async (tx) => {
      await tx
        .update(tokens)
        .set({ activityCovered: true, volumeWei: pairIsEth ? sql`coalesce(${tokens.volumeWei}, 0)` : null })
        .where(and(eq(tokens.chainId, this.chainId), eq(tokens.address, tokenLower)));
    }, [tokenLower]);
    log("info", "indexer.backfilled", { token: tokenLower, transfers: transferLogs.length, curveEvents: curveLogs.length, from: l.blockNumber, through });
  }

  // ── Shared write path ──────────────────────────────────────────────────────
  private async applyLogs(transferLogs: Log[], curveLogs: Log[], head: bigint, finalize: (tx: Tx) => Promise<void>, alwaysRefresh: string[] = []): Promise<number> {
    const transfers = transferLogs.map(decodeTransfer).filter((x): x is DecodedTransfer => !!x);
    const trades = curveLogs.map(decodeTrade).filter((x): x is DecodedTrade => !!x);
    const grads = curveLogs.filter((l) => GRADUATION_TOPICS.has(l.topics[0] ?? "")).map((l) => ({ log: l, blockNumber: l.blockNumber!, timestamp: null as Date | null }));
    await this.ts.resolve([...transfers, ...trades, ...grads], head);
    const touched = new Set<string>(alwaysRefresh);
    let inserted = 0;

    await this.db.transaction(async (tx) => {
      const fresh: DecodedTransfer[] = [];
      for (let i = 0; i < transfers.length; i += 1000) {
        const slice = transfers.slice(i, i + 1000);
        const rows = await tx
          .insert(transactionEvents)
          .values(slice.map((t) => ({ chainId: this.chainId, txHash: t.txHash, logIndex: t.logIndex, blockNumber: t.blockNumber, timestamp: t.timestamp!, tokenAddress: lc(t.token), walletAddress: lc(t.to), counterparty: lc(t.from), eventType: "transfer", amount: t.value.toString() })))
          .onConflictDoNothing()
          .returning({ txHash: transactionEvents.txHash, logIndex: transactionEvents.logIndex });
        const ok = new Set(rows.map((r) => `${r.txHash}:${r.logIndex}`));
        fresh.push(...slice.filter((t) => ok.has(`${t.txHash}:${t.logIndex}`)));
      }
      inserted += fresh.length;
      // Balance deltas only from rows inserted now → reprocessing a range can never double-count.
      const now = new Date();
      const entries = [...balanceDeltas(fresh).entries()].filter(([, v]) => v !== 0n);
      for (let i = 0; i < entries.length; i += 1000) {
        await tx
          .insert(holders)
          .values(
            entries.slice(i, i + 1000).map(([k, v]) => {
              const [token, wallet] = k.split(":");
              return { chainId: this.chainId, tokenAddress: token, walletAddress: wallet, balance: v.toString(), firstSeenAt: now, lastUpdatedAt: now };
            }),
          )
          .onConflictDoUpdate({ target: [holders.chainId, holders.tokenAddress, holders.walletAddress], set: { balance: sql`${holders.balance} + excluded.balance`, lastUpdatedAt: now } });
      }
      for (const t of fresh) touched.add(lc(t.token));

      for (const tr of trades) {
        const ref = this.curves.get(lc(tr.curve));
        if (!ref) continue;
        const rows = await tx
          .insert(transactionEvents)
          .values({ chainId: this.chainId, txHash: tr.txHash, logIndex: tr.logIndex, blockNumber: tr.blockNumber, timestamp: tr.timestamp!, tokenAddress: ref.token, walletAddress: lc(tr.trader), counterparty: lc(tr.curve), eventType: tr.kind, amount: tr.tokenAmount.toString(), quoteAmount: tr.quoteAmount.toString() })
          .onConflictDoNothing()
          .returning({ id: transactionEvents.id });
        if (!rows.length) continue;
        inserted++;
        touched.add(ref.token);
        if (ref.creator === lc(tr.trader)) {
          await tx
            .insert(feedEvents)
            .values({ chainId: this.chainId, tokenAddress: ref.token, kind: "creator_activity", message: `Creator wallet ${tr.kind === "buy" ? "bought" : "sold"} on the bonding curve`, txHash: tr.txHash, createdAt: tr.timestamp! })
            .onConflictDoNothing();
        }
      }

      for (const g of grads) {
        const ref = this.curves.get(lc(g.log.address));
        if (!ref) continue;
        await tx.update(launches).set({ status: "graduated", graduatedAt: g.timestamp }).where(and(eq(launches.chainId, this.chainId), eq(launches.tokenAddress, ref.token)));
        await tx
          .insert(feedEvents)
          .values({ chainId: this.chainId, tokenAddress: ref.token, kind: "graduation", message: "Graduation event observed on bonding curve", txHash: g.log.transactionHash, createdAt: g.timestamp! })
          .onConflictDoNothing();
        touched.add(ref.token);
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

  async refreshCounters(db: DB | Tx, tokenAddrs: string[]) {
    const excluded = [...DEAD_ADDRESSES, ...PROTOCOL_HOLDER_EXCLUSIONS.map((x) => x.address)];
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
          where h.chain_id = ${this.chainId} and h.token_address = s.address and h.balance > 0
            and h.wallet_address not in ${excluded}
            and h.wallet_address not in (select curve_address from launches where chain_id = ${this.chainId} and token_address = s.address and curve_address is not null)
        ) h on true
        left join lateral (
          select count(*) filter (where event_type = 'transfer') as transfers,
                 count(*) filter (where event_type = 'buy') as buys,
                 count(*) filter (where event_type = 'sell') as sells,
                 count(distinct wallet_address) filter (where event_type = 'buy') as buyers,
                 count(distinct wallet_address) filter (where event_type = 'sell') as sellers,
                 sum(quote_amount) filter (where event_type in ('buy','sell')) as vol,
                 max(timestamp) as last_at
          from transaction_events where chain_id = ${this.chainId} and token_address = s.address
        ) e on true
        where t.chain_id = ${this.chainId} and t.address = s.address and t.activity_covered`);
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
}



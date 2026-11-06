import { and, desc, eq, sql } from "drizzle-orm";
import { formatEther, getAddress, type Address } from "viem";
import { analyzeContract, type ContractAnalysis } from "../analysis/contract";
import { cached, invalidate } from "../cache/cache";
import { getProvider, type ChainProvider } from "../chain/provider";
import type { NetworkInfo, NetworkSlug } from "../chain/networks";
import { getDb, schema, type DB } from "../db/client";
import { blockscoutFor } from "../explorer/blockscout";
import type { Evidence, Observed } from "../verification/types";
import { isDemoMode } from "../demo/mode";
import { protocolExclusions, launchpadLabel } from "../launchpads/registry";
import { extractClaims } from "../metadata/ingest";
import { demoPassport } from "../demo/data";
import { serviceNetwork } from "./network";
import type { ActivityMetrics, CoverageInfo, MetadataSection, ProofSection, Reconciliation, TokenPassport } from "./types";
import { freshCheck } from "../proof/freshness";
import { controlState } from "../proof/challenges";
import type { UrlCheckResult } from "../proof/checks";
import { storeContractObservation } from "./history-service";
import { ZERO_ADDRESS } from "../util/address";

const { tokens, launches, creators, holders, transactionEvents, projectProofs, verificationChecks, indexerState, backfillQueue, tokenMetadata } = schema;
const ANALYSIS_TTL_MS = 6 * 3600_000;

export async function activityCursor(chainId = serviceNetwork().chainId): Promise<bigint | null> {
  const db = getDb();
  if (!db) return null;
  const row = await db.query.indexerState.findFirst({ where: eq(indexerState.key, `activity:${chainId}`) });
  return row?.lastBlock ?? null;
}

/** Contract analysis is cached in Postgres; recomputed at most every 6h (or on demand). */
export async function getContractAnalysis(
  address: Address,
  opts: { refresh?: boolean; network?: NetworkSlug; provider?: ChainProvider } = {},
): Promise<ContractAnalysis> {
  const net = serviceNetwork(opts.network);
  const db = getDb();
  const a = address.toLowerCase();
  if (db && !opts.refresh) {
    const row = await db.query.tokens.findFirst({ where: and(eq(tokens.chainId, net.chainId), eq(tokens.address, a)) });
    if (row?.analysis && row.analyzedAt && Date.now() - row.analyzedAt.getTime() < ANALYSIS_TTL_MS) return row.analysis as ContractAnalysis;
  }
  const analysis = await analyzeContract(opts.provider ?? getProvider(net.slug), address);
  if (db && analysis.basics.exists) {
    const b = analysis.basics;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${net.chainId}::int, hashtext(${a}))`);
      await storeContractObservation(tx as unknown as DB, opts.provider ?? getProvider(net.slug), address, analysis);
      await tx
        .insert(tokens)
        .values({
          chainId: net.chainId,
          address: a,
          name: b.name,
          symbol: b.symbol,
          decimals: b.decimals,
          totalSupply: b.totalSupply,
          verifiedContract: analysis.sourceVerified,
          analysis,
          analyzedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [tokens.chainId, tokens.address],
          set: {
            name: sql`coalesce(excluded.name, ${tokens.name})`,
            symbol: sql`coalesce(excluded.symbol, ${tokens.symbol})`,
            decimals: sql`coalesce(excluded.decimals, ${tokens.decimals})`,
            totalSupply: sql`coalesce(excluded.total_supply, ${tokens.totalSupply})`,
            verifiedContract: analysis.sourceVerified,
            analysis,
            analyzedAt: new Date(),
            updatedAt: new Date(),
          },
        });
    });
  }
  return analysis;
}

function obs<T>(value: T | null | undefined, evidence: Evidence, reason?: string): Observed<T> {
  if (value === null || value === undefined) return { value: null, state: "unavailable", evidence, error: reason ?? "Not yet measured" };
  return { value, state: "observed", evidence };
}

export async function getProofSection(address: string, network?: NetworkSlug): Promise<ProofSection> {
  const net = serviceNetwork(network);
  const db = getDb();
  const empty: ProofSection = {
    submitted: false,
    submittedBy: null,
    submitterIsCreator: false,
    submittedAt: null,
    description: null,
    metadataHash: null,
    registryTx: null,
    checks: [],
    score: { observed: 0, total: 3 },
  };
  if (!db) return empty;
  const a = address.toLowerCase();
  const proof = await db.query.projectProofs.findFirst({ where: and(eq(projectProofs.chainId, net.chainId), eq(projectProofs.tokenAddress, a)) });
  if (!proof) return empty;
  const latest = await db.execute<{ check_type: string; status: string; evidence: UrlCheckResult }>(sql`
    select distinct on (check_type) check_type, status, evidence from ${verificationChecks}
    where chain_id = ${net.chainId} and token_address = ${a} and check_type not like 'metadata\\_%'
    order by check_type, observed_at desc`);
  const checks = [...latest]
    .map((r) => freshCheck(r.evidence))
    .filter((c) => [proof.websiteUrl, proof.githubUrl, proof.demoUrl, proof.docsUrl, proof.twitterUrl, proof.discordUrl].includes(c.url));
  const controls = await db
    .select()
    .from(schema.ownershipChallenges)
    .where(
      and(
        eq(schema.ownershipChallenges.chainId, net.chainId),
        eq(schema.ownershipChallenges.tokenAddress, a),
        eq(schema.ownershipChallenges.creatorAddress, proof.submittedBy),
      ),
    )
    .orderBy(desc(schema.ownershipChallenges.createdAt))
    .limit(20);
  const core = ["website", "github", "demo"] as const;
  const observed = checks.filter((c) => (core as readonly string[]).includes(c.type) && (c.state === "verified" || c.state === "observed")).length;
  return {
    submitted: true,
    submittedBy: proof.submittedBy,
    submitterIsCreator: proof.submitterIsCreator,
    submittedAt: proof.createdAt.toISOString(),
    description: proof.description,
    metadataHash: proof.metadataHash,
    controls: controls.map((c) => ({
      kind: c.kind,
      target: c.target,
      status: controlState(c),
      firstObservedAt: c.createdAt.toISOString(),
      lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
      lastVerifiedAt: c.verifiedAt?.toISOString() ?? null,
      expiresAt: c.validUntil?.toISOString() ?? c.expiresAt.toISOString(),
    })),
    registryTx: proof.registryTx,
    metadataUri: proof.metadataUri,
    checks,
    score: { observed, total: core.length },
  };
}

type LaunchRow = typeof launches.$inferSelect;
type TokenRow = typeof tokens.$inferSelect;

/** Coverage state for one token (see CoverageInfo). Never claims coverage it does not have. */
export async function getCoverage(
  db: DB,
  chainId: number,
  a: string,
  launch: LaunchRow | undefined,
  row: TokenRow | undefined,
  cursor: bigint | null,
): Promise<CoverageInfo> {
  const base = { indexedThrough: cursor?.toString() ?? null, launchBlock: launch?.blockNumber.toString() ?? null };
  if (!launch)
    return { ...base, status: "not_indexed", backfill: null, explanation: "Not announced by a configured launchpad factory, so its activity is not indexed." };
  if (row?.activityCovered && cursor !== null)
    return {
      ...base,
      status: "fully_covered",
      backfill: null,
      explanation: `Every Transfer and curve event from launch block ${launch.blockNumber} through block ${cursor} is indexed.`,
    };
  const q = await db.query.backfillQueue.findFirst({ where: and(eq(backfillQueue.chainId, chainId), eq(backfillQueue.tokenAddress, a)) });
  if (!q) return { ...base, status: "not_indexed", backfill: null, explanation: "History has not been indexed and no backfill is queued." };
  let position: number | null = null;
  if (q.status === "pending" || q.status === "failed") {
    const [r] = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from backfill_queue
      where chain_id = ${chainId} and status in ('pending', 'failed') and (priority > ${q.priority} or (priority = ${q.priority} and launch_block > ${q.launchBlock ?? 0n}))`);
    position = Number(r?.n ?? 0);
  }
  const backfill = {
    status: q.status,
    reason: q.reason,
    attempts: q.attempts,
    lastError: q.error,
    nextAttemptAt: q.nextAttemptAt?.toISOString() ?? null,
    requestedAt: q.requestedAt.toISOString(),
    position,
  };
  if (q.status === "started")
    return { ...base, status: "indexing", backfill, explanation: `History since launch block ${launch.blockNumber} is being indexed now.` };
  if (q.status === "failed" || q.status === "dead")
    return {
      ...base,
      status: "error",
      backfill,
      explanation:
        q.status === "dead"
          ? `The history backfill failed ${q.attempts} times and was set aside; counters stay unavailable.`
          : `The history backfill failed (attempt ${q.attempts}); it will be retried${q.nextAttemptAt ? ` after ${q.nextAttemptAt.toISOString()}` : ""}.`,
    };
  if (q.status === "completed" && !row?.activityCovered)
    return {
      ...base,
      status: "partial",
      backfill,
      explanation: "A previous backfill completed but coverage was reset (e.g. after a reorg); it will be re-indexed.",
    };
  return {
    ...base,
    status: "partial",
    backfill,
    explanation: `History since launch block ${launch.blockNumber} is queued for indexing${position !== null ? ` (${position} ahead)` : ""}. Counters stay unavailable until it completes.`,
  };
}

/** Launch metadata as fetched by the indexer, with integrity results. Contents are creator claims. */
export async function getMetadataSection(db: DB, net: NetworkInfo, a: string, observedAt: string): Promise<MetadataSection | null> {
  const m = await db.query.tokenMetadata.findFirst({ where: and(eq(tokenMetadata.chainId, net.chainId), eq(tokenMetadata.tokenAddress, a)) });
  if (!m) return null;
  const checks = await db.execute<{ evidence: UrlCheckResult }>(sql`
    select distinct on (check_type) evidence from ${verificationChecks}
    where chain_id = ${net.chainId} and token_address = ${a} and check_type like 'metadata\\_%'
    order by check_type, observed_at desc`);
  return {
    uri: m.uri,
    status: m.status,
    gateway: m.gateway,
    normalizedUrl: m.normalizedUrl,
    fetchedAt: m.fetchedAt?.toISOString() ?? null,
    cidVerified: m.cidVerified,
    onchainDigest: m.onchainDigest,
    digestMatch: m.digestMatch,
    keccak256: m.keccak256,
    error: m.error,
    claims: m.status === "ok" && m.data ? extractClaims(m.data as Record<string, unknown>) : null,
    checks: [...checks].map((r) => freshCheck(r.evidence)),
    evidence: {
      source: m.gateway ? `IPFS/HTTPS fetch via ${m.gateway}` : "Launch event metadataURI",
      method: "SSRF-guarded GET (≤64 KB, no compression); sha256 checked against the CID, keccak256 against the onchain metadataDigest where present",
      observedAt: m.fetchedAt?.toISOString() ?? observedAt,
      url: m.normalizedUrl ?? undefined,
      detail: m.cidVerified
        ? "Content hashes to the CID in the launch event."
        : m.cidVerified === false
          ? "Content did NOT hash to the CID."
          : "CID kind cannot be checked locally.",
    },
  };
}

async function buildPassport(address: Address, net: NetworkInfo): Promise<TokenPassport | null> {
  const a = address.toLowerCase();
  const observedAt = new Date().toISOString();
  const contract = await getContractAnalysis(address, { network: net.slug });
  if (!contract.basics.exists) return null;
  const db = getDb();
  const c = net.chainId;
  const explorer = blockscoutFor(net.slug);

  const [row, launch, cursor] = db
    ? await Promise.all([
        db.query.tokens.findFirst({ where: and(eq(tokens.chainId, c), eq(tokens.address, a)) }),
        db.query.launches.findFirst({ where: and(eq(launches.chainId, c), eq(launches.tokenAddress, a)) }),
        activityCursor(c),
      ])
    : [undefined, undefined, null];

  const creatorAddr = launch?.creatorAddress ?? null;
  const creatorRow =
    db && creatorAddr ? await db.query.creators.findFirst({ where: and(eq(creators.chainId, c), eq(creators.address, creatorAddr)) }) : undefined;
  // Only present indexer counters when the token's COMPLETE history is indexed.
  const covered = !!(launch && row?.activityCovered && cursor !== null);
  let queued = false;
  if (db && launch && !covered) {
    // Prioritise this token's history backfill. The request does no RPC work itself, and only
    // indexed launches can be queued, which bounds what a visitor can make the indexer fetch.
    await db.execute(sql`
      insert into backfill_queue (chain_id, token_address, status, reason, priority, launch_block)
      values (${c}, ${a}, 'pending', 'on_demand', 100, ${launch.blockNumber})
      on conflict (chain_id, token_address) do update set
        priority = greatest(backfill_queue.priority, 100),
        status = case when backfill_queue.status = 'completed' then 'pending' else backfill_queue.status end,
        updated_at = now()`);
    await db
      .update(tokenMetadata)
      .set({ priority: 100 })
      .where(and(eq(tokenMetadata.chainId, c), eq(tokenMetadata.tokenAddress, a), eq(tokenMetadata.status, "pending")));
    queued = true;
  }
  const coverage: CoverageInfo = db
    ? await getCoverage(db, c, a, launch, row, cursor)
    : { status: "not_indexed", explanation: "No database is configured.", indexedThrough: null, launchBlock: null, backfill: null };

  const idxEvidence: Evidence = {
    source: `VibeProof indexer (${net.name} logs)`,
    method: "Aggregation of ERC-20 Transfer and launchpad curve buy/sell events since launch",
    observedAt,
    block: cursor?.toString(),
    contract: getAddress(address),
  };
  const bsEv: Evidence = {
    source: `Blockscout (${net.name} explorer)`,
    method: "GET /api/v2/tokens/{address}/counters",
    observedAt,
    url: `${net.explorerUrl}/token/${address}`,
  };
  const n = (s: string | null | undefined) => (s === null || s === undefined || s === "" ? null : Number(s));
  const holderMethod =
    "Net balances from Transfer events; excludes the zero/dead addresses, the token contract itself, its bonding curve and launchpad protocol contracts (e.g. the Uniswap v4 PoolManager, lockers)";

  let activity: ActivityMetrics;
  let reconciliation: Reconciliation | null = null;
  const [bsToken, counters] = await Promise.all([explorer.token(address), explorer.tokenCounters(address)]);
  const explorerHolders = n(counters?.token_holders_count ?? bsToken?.holders_count ?? bsToken?.holders);
  const explorerTransfers = n(counters?.transfers_count);
  if (covered && row) {
    const pairIsEth = !launch!.pairCurrency || launch!.pairCurrency === ZERO_ADDRESS;
    activity = {
      holders: obs(row.holderCount, { ...idxEvidence, method: holderMethod }),
      transactions: obs(row.transferCount, { ...idxEvidence, method: "Count of ERC-20 Transfer events" }),
      buys: obs(row.buyCount, { ...idxEvidence, method: "Count of curve buy events (CurveBuy / Bought)" }),
      sells: obs(row.sellCount, { ...idxEvidence, method: "Count of curve sell events (CurveSell / Sold)" }),
      buyers: obs(row.uniqueBuyers, { ...idxEvidence, method: "Distinct buy recipients" }),
      sellers: obs(row.uniqueSellers, { ...idxEvidence, method: "Distinct sellers" }),
      volumeEth: pairIsEth
        ? obs(row.volumeWei !== null ? formatEther(BigInt(row.volumeWei)) : null, { ...idxEvidence, method: "Sum of ETH paid/received in curve trades" })
        : {
            value: null,
            state: "unavailable",
            evidence: idxEvidence,
            error: `The curve is quoted in ${launch!.pairCurrency}, not ETH, so an ETH volume is not comparable.`,
          },
      lastActivityAt: obs(row.lastActivityAt?.toISOString(), idxEvidence, "No activity observed yet"),
    };
    reconciliation = [
      {
        metric: "holders",
        indexer: row.holderCount,
        explorer: explorerHolders,
        explanation:
          "VibeProof excludes protocol-held balances (bonding curve, token contract, launchpad and pool contracts, zero/dead); Blockscout counts every address with a positive balance and may lag or index differently.",
        evidence: { indexer: { ...idxEvidence, method: holderMethod }, explorer: bsEv },
      },
      {
        metric: "transfers",
        indexer: row.transferCount,
        explorer: explorerTransfers,
        explanation: `VibeProof counts ERC-20 Transfer logs through block ${cursor}; Blockscout counts the token transfers it has indexed at its own head.`,
        evidence: { indexer: idxEvidence, explorer: bsEv },
      },
    ];
  } else {
    // History not (yet) complete: show explorer counters, clearly attributed; never our partial counts.
    const reason = coverage.explanation;
    const ua = <T>(): Observed<T> => ({ value: null, state: "unavailable", evidence: idxEvidence, error: reason });
    activity = {
      holders: obs(explorerHolders, bsEv, "Explorer unavailable; VibeProof history incomplete"),
      transactions: obs(explorerTransfers, bsEv, "Explorer unavailable; VibeProof history incomplete"),
      buys: ua(),
      sells: ua(),
      buyers: ua(),
      sellers: ua(),
      volumeEth: ua(),
      lastActivityAt: ua(),
    };
  }

  const recent =
    db && covered
      ? (
          await db
            .select()
            .from(transactionEvents)
            .where(and(eq(transactionEvents.chainId, c), eq(transactionEvents.tokenAddress, a)))
            .orderBy(desc(transactionEvents.blockNumber), desc(transactionEvents.logIndex))
            .limit(25)
        ).map((e) => ({
          txHash: e.txHash,
          logIndex: e.logIndex,
          blockNumber: e.blockNumber.toString(),
          timestamp: e.timestamp.toISOString(),
          type: e.eventType,
          wallet: e.walletAddress,
          amount: e.amount,
          quoteAmount: e.quoteAmount,
        }))
      : [];

  let topHolders: TokenPassport["topHolders"] = null;
  if (db && covered) {
    const supply = contract.basics.totalSupply ? BigInt(contract.basics.totalSupply) : null;
    const top = await db
      .select()
      .from(holders)
      .where(and(eq(holders.chainId, c), eq(holders.tokenAddress, a), sql`${holders.balance} > 0`))
      .orderBy(desc(holders.balance))
      .limit(10);
    const labels = new Map<string, string>([
      ...protocolExclusions(c).map((x) => [x.address, x.label] as const),
      [a, "token contract"] as const,
      ...(launch?.curveAddress ? [[launch.curveAddress, "bonding curve"] as const] : []),
    ]);
    topHolders = top.map((h) => ({
      wallet: h.walletAddress,
      balance: h.balance,
      pct: supply && supply > 0n ? Number((BigInt(h.balance) * 1_000_000n) / supply) / 10_000 : null,
      label: labels.get(h.walletAddress) ?? null,
    }));
  }

  return {
    chain: net.slug,
    chainName: net.name,
    chainId: c,
    address: getAddress(address),
    name: contract.basics.name ?? row?.name ?? null,
    symbol: contract.basics.symbol ?? row?.symbol ?? null,
    decimals: contract.basics.decimals ?? row?.decimals ?? null,
    totalSupply: contract.basics.totalSupply ?? row?.totalSupply ?? null,
    isVibeLaunch: !!launch,
    createdAt: launch?.createdAt.toISOString() ?? row?.createdAt?.toISOString() ?? null,
    metadataUri: row?.metadataUri ?? null,
    launch: launch
      ? {
          launchpad: launch.launchpad,
          deploymentId: launch.deploymentId,
          version: launch.version,
          eventName: launch.eventName,
          factory: getAddress(launch.factoryAddress),
          launchId: launch.launchId,
          curve: launch.curveAddress ? getAddress(launch.curveAddress) : null,
          pairCurrency: launch.pairCurrency,
          txHash: launch.txHash,
          blockNumber: launch.blockNumber.toString(),
          createdAt: launch.createdAt.toISOString(),
          createdAtExact: launch.createdAtExact,
          status: launch.status,
          graduatedAt: launch.graduatedAt?.toISOString() ?? null,
          graduatedTx: launch.graduatedTx,
          curveCompletedAt: launch.curveCompletedAt?.toISOString() ?? null,
        }
      : null,
    contract,
    creator: creatorAddr
      ? {
          address: getAddress(creatorAddr),
          firstSeenAt: creatorRow?.firstSeenAt?.toISOString() ?? null,
          launchCount: creatorRow?.launchCount ?? 1,
          graduatedLaunchCount: creatorRow?.graduatedLaunchCount ?? 0,
          activeLaunchCount: creatorRow?.activeLaunchCount ?? 0,
          historicalLaunchCount: creatorRow?.historicalLaunchCount ?? 0,
          evidence: {
            source: "VibeProof indexer",
            method: `Launch events emitted by ${launchpadLabel(c, launch!.launchpad)} factories, grouped by launcher address`,
            observedAt,
            contract: launch!.factoryAddress,
          },
        }
      : null,
    activity,
    proof: await getProofSection(a, net.slug),
    recent,
    topHolders,
    indexer: { indexedThrough: cursor?.toString() ?? null, covered, queued },
    coverage,
    metadata: db ? await getMetadataSection(db, net, a, observedAt) : null,
    reconciliation,
    observedAt,
    demo: false,
  };
}

export async function getTokenPassport(
  address: Address,
  opts: { network?: NetworkSlug | string | null } = {},
): Promise<{ passport: TokenPassport | null; cached: boolean }> {
  if (isDemoMode()) return { passport: demoPassport(address), cached: false };
  const net = serviceNetwork(opts.network);
  const { value, cached: hit } = await cached(`passport:v2:${net.chainId}:${address.toLowerCase()}`, { ttl: 20, swr: 120 }, () => buildPassport(address, net));
  return { passport: value, cached: hit };
}

export const invalidatePassport = (address: string, chainId = serviceNetwork().chainId) => invalidate(`passport:v2:${chainId}:${address.toLowerCase()}`);

export type SeriesPoint = { t: string; transfers: number; buys: number; sells: number };

/** Hourly buckets of indexed events. Buckets with no rows are zero *because the range is covered*. */
export async function getActivitySeries(address: Address, days = 7, network?: NetworkSlug | string | null): Promise<SeriesPoint[] | null> {
  if (isDemoMode()) {
    const base = Date.parse("2026-09-30T12:00:00Z");
    return Array.from({ length: 48 }, (_, i) => {
      const w = Math.round(12 + 10 * Math.sin(i / 4) + (i % 7) * 2 + i * 0.6);
      return { t: new Date(base - (47 - i) * 3600_000).toISOString(), transfers: w, buys: Math.round(w * 0.7), sells: Math.round(w * 0.2) };
    });
  }
  const db = getDb();
  if (!db) return null;
  const c = serviceNetwork(network).chainId;
  const a = address.toLowerCase();
  const tok = await db.query.tokens.findFirst({ where: and(eq(tokens.chainId, c), eq(tokens.address, a)) });
  // Zero-filled buckets are only honest when the token's full history is indexed.
  if (!tok?.activityCovered) return null;
  const rows = await db.execute<{ bucket: Date; transfers: string; buys: string; sells: string }>(sql`
    with e as (
      select date_trunc('hour', timestamp) as bucket,
        count(*) filter (where event_type = 'transfer') as transfers,
        count(*) filter (where event_type = 'buy') as buys,
        count(*) filter (where event_type = 'sell') as sells
      from ${transactionEvents}
      where chain_id = ${c} and token_address = ${a} and timestamp > now() - make_interval(days => ${days})
      group by 1
    )
    select g.bucket, coalesce(e.transfers, 0) as transfers, coalesce(e.buys, 0) as buys, coalesce(e.sells, 0) as sells
    from generate_series(
      date_trunc('hour', greatest(now() - make_interval(days => ${days}), coalesce(${tok.createdAt?.toISOString() ?? null}::timestamptz, now() - make_interval(days => ${days})))),
      date_trunc('hour', now()), interval '1 hour') as g(bucket)
    left join e on e.bucket = g.bucket
    order by 1`);
  return [...rows].map((r) => ({ t: new Date(r.bucket).toISOString(), transfers: Number(r.transfers), buys: Number(r.buys), sells: Number(r.sells) }));
}

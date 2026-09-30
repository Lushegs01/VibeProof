import { and, desc, eq, sql } from "drizzle-orm";
import { formatEther, getAddress, type Address } from "viem";
import { analyzeContract, type ContractAnalysis } from "../analysis/contract";
import { cached, invalidate } from "../cache/cache";
import { getProvider } from "../chain/provider";
import { getDb, schema } from "../db/client";
import { blockscout } from "../explorer/blockscout";
import type { Evidence, Observed } from "../verification/types";
import { isDemoMode } from "../demo/mode";
import { PROTOCOL_HOLDER_EXCLUSIONS } from "../vibe/contracts";
import { demoPassport } from "../demo/data";
import type { ActivityMetrics, ProofSection, TokenPassport } from "./types";
import type { UrlCheckResult } from "../proof/checks";

const { tokens, launches, creators, holders, transactionEvents, projectProofs, verificationChecks, indexerState } = schema;
const CHAIN = "robinhood-testnet";
const CHAIN_ID = 46630;
const ANALYSIS_TTL_MS = 6 * 3600_000;

export async function activityCursor(): Promise<bigint | null> {
  const db = getDb();
  if (!db) return null;
  const row = await db.query.indexerState.findFirst({ where: eq(indexerState.key, `activity:${CHAIN_ID}`) });
  return row?.lastBlock ?? null;
}

/** Contract analysis is cached in Postgres; recomputed at most every 6h (or on demand). */
export async function getContractAnalysis(address: Address, opts: { refresh?: boolean } = {}): Promise<ContractAnalysis> {
  const db = getDb();
  const a = address.toLowerCase();
  if (db && !opts.refresh) {
    const row = await db.query.tokens.findFirst({ where: and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, a)) });
    if (row?.analysis && row.analyzedAt && Date.now() - row.analyzedAt.getTime() < ANALYSIS_TTL_MS) return row.analysis as ContractAnalysis;
  }
  const analysis = await analyzeContract(getProvider(), address);
  if (db && analysis.basics.exists) {
    const b = analysis.basics;
    await db
      .insert(tokens)
      .values({ chainId: CHAIN_ID, address: a, name: b.name, symbol: b.symbol, decimals: b.decimals, totalSupply: b.totalSupply, verifiedContract: analysis.sourceVerified, analysis, analyzedAt: new Date() })
      .onConflictDoUpdate({
        target: [tokens.chainId, tokens.address],
        set: { name: sql`coalesce(excluded.name, ${tokens.name})`, symbol: sql`coalesce(excluded.symbol, ${tokens.symbol})`, decimals: b.decimals, totalSupply: b.totalSupply, verifiedContract: analysis.sourceVerified, analysis, analyzedAt: new Date(), updatedAt: new Date() },
      });
  }
  return analysis;
}

function obs<T>(value: T | null | undefined, evidence: Evidence, reason?: string): Observed<T> {
  if (value === null || value === undefined) return { value: null, state: "unavailable", evidence, error: reason ?? "Not yet measured" };
  return { value, state: "observed", evidence };
}

export async function getProofSection(address: string): Promise<ProofSection> {
  const db = getDb();
  const empty: ProofSection = { submitted: false, submittedBy: null, submitterIsCreator: false, submittedAt: null, description: null, metadataHash: null, registryTx: null, checks: [], score: { observed: 0, total: 3 } };
  if (!db) return empty;
  const a = address.toLowerCase();
  const proof = await db.query.projectProofs.findFirst({ where: and(eq(projectProofs.chainId, CHAIN_ID), eq(projectProofs.tokenAddress, a)) });
  if (!proof) return empty;
  const latest = await db.execute<{ check_type: string; status: string; evidence: UrlCheckResult }>(sql`
    select distinct on (check_type) check_type, status, evidence from ${verificationChecks}
    where chain_id = ${CHAIN_ID} and token_address = ${a}
    order by check_type, observed_at desc`);
  const checks = [...latest].map((r) => r.evidence);
  const core = ["website", "github", "demo"] as const;
  const observed = checks.filter((c) => (core as readonly string[]).includes(c.type) && (c.state === "verified" || c.state === "observed")).length;
  return {
    submitted: true,
    submittedBy: proof.submittedBy,
    submitterIsCreator: proof.submitterIsCreator,
    submittedAt: proof.createdAt.toISOString(),
    description: proof.description,
    metadataHash: proof.metadataHash,
    registryTx: proof.registryTx,
    checks,
    score: { observed, total: core.length },
  };
}

async function buildPassport(address: Address): Promise<TokenPassport | null> {
  const a = address.toLowerCase();
  const observedAt = new Date().toISOString();
  const contract = await getContractAnalysis(address);
  if (!contract.basics.exists) return null;
  const db = getDb();

  const [row, launch, cursor] = db
    ? await Promise.all([
        db.query.tokens.findFirst({ where: and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, a)) }),
        db.query.launches.findFirst({ where: and(eq(launches.chainId, CHAIN_ID), eq(launches.tokenAddress, a)) }),
        activityCursor(),
      ])
    : [undefined, undefined, null];

  const creatorAddr = launch?.creatorAddress ?? null;
  const creatorRow = db && creatorAddr ? await db.query.creators.findFirst({ where: and(eq(creators.chainId, CHAIN_ID), eq(creators.address, creatorAddr)) }) : undefined;
  // Only present indexer counters when the token's COMPLETE history is indexed.
  const covered = !!(launch && row?.activityCovered && cursor !== null);
  let queued = false;
  if (db && launch && !covered) {
    // Ask the indexer for a per-token backfill; the request itself does no RPC work.
    await db.insert(schema.backfillQueue).values({ chainId: CHAIN_ID, tokenAddress: a }).onConflictDoNothing();
    queued = true;
  }

  const idxEvidence: Evidence = {
    source: "VibeProof indexer (Robinhood Chain Testnet logs)",
    method: "Aggregation of ERC-20 Transfer and vibe/vibe curve Buy/Sell events since launch",
    observedAt,
    block: cursor?.toString(),
    contract: getAddress(address),
  };

  let activity: ActivityMetrics;
  if (covered && row) {
    const pairIsEth = !launch!.pairCurrency || launch!.pairCurrency === "0x0000000000000000000000000000000000000000";
    activity = {
      holders: obs(row.holderCount, { ...idxEvidence, method: "Net balances from Transfer events; excludes zero/dead addresses, the bonding curve and vibe/vibe protocol contracts (e.g. Uniswap v4 PoolManager, lockers)" }),
      transactions: obs(row.transferCount, { ...idxEvidence, method: "Count of ERC-20 Transfer events" }),
      buys: obs(row.buyCount, { ...idxEvidence, method: "Count of curve buy events (CurveBuy / Bought)" }),
      sells: obs(row.sellCount, { ...idxEvidence, method: "Count of curve sell events (CurveSell / Sold)" }),
      buyers: obs(row.uniqueBuyers, { ...idxEvidence, method: "Distinct buy recipients" }),
      sellers: obs(row.uniqueSellers, { ...idxEvidence, method: "Distinct sellers" }),
      volumeEth: pairIsEth
        ? obs(row.volumeWei !== null ? formatEther(BigInt(row.volumeWei)) : null, { ...idxEvidence, method: "Sum of ETH paid/received in curve trades" })
        : { value: null, state: "unavailable", evidence: idxEvidence, error: `Curve is paired with ${launch!.pairCurrency}, not ETH; ETH volume is not comparable.` },
      lastActivityAt: obs(row.lastActivityAt?.toISOString(), idxEvidence, "No activity observed yet"),
    };
  } else {
    // Not covered by our indexer: fall back to explorer counters, clearly attributed.
    const [tok, counters] = await Promise.all([blockscout.token(address), blockscout.tokenCounters(address)]);
    const bsEv: Evidence = { source: "Blockscout (Robinhood Chain Testnet explorer)", method: "GET /api/v2/tokens/{address}/counters", observedAt, url: `https://explorer.testnet.chain.robinhood.com/token/${address}` };
    const reason = launch
      ? queued
        ? "Queued for full-history indexing; showing explorer counters until complete."
        : "Indexer has not covered this launch yet."
      : "Not a recognised vibe/vibe launch; curve activity is not indexed.";
    const n = (s: string | null | undefined) => (s === null || s === undefined || s === "" ? null : Number(s));
    const ua = <T,>(): Observed<T> => ({ value: null, state: "unavailable", evidence: idxEvidence, error: reason });
    activity = {
      holders: obs(n(counters?.token_holders_count ?? tok?.holders_count), bsEv, "Explorer unavailable"),
      transactions: obs(n(counters?.transfers_count), bsEv, "Explorer unavailable"),
      buys: ua(),
      sells: ua(),
      buyers: ua(),
      sellers: ua(),
      volumeEth: ua(),
      lastActivityAt: ua(),
    };
  }

  const recent = db
    ? (await db.select().from(transactionEvents).where(and(eq(transactionEvents.chainId, CHAIN_ID), eq(transactionEvents.tokenAddress, a))).orderBy(desc(transactionEvents.blockNumber), desc(transactionEvents.logIndex)).limit(25)).map((e) => ({
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
    const top = await db.select().from(holders).where(and(eq(holders.chainId, CHAIN_ID), eq(holders.tokenAddress, a), sql`${holders.balance} > 0`)).orderBy(desc(holders.balance)).limit(10);
    const labels = new Map<string, string>([...PROTOCOL_HOLDER_EXCLUSIONS.map((x) => [x.address, x.label] as const), ...(launch?.curveAddress ? [[launch.curveAddress, "bonding curve"] as const] : [])]);
    topHolders = top.map((h) => ({ wallet: h.walletAddress, balance: h.balance, pct: supply && supply > 0n ? Number((BigInt(h.balance) * 1_000_000n) / supply) / 10_000 : null, label: labels.get(h.walletAddress) ?? null }));
  }

  return {
    chain: CHAIN,
    chainId: CHAIN_ID,
    address: getAddress(address),
    name: contract.basics.name ?? row?.name ?? null,
    symbol: contract.basics.symbol ?? row?.symbol ?? null,
    decimals: contract.basics.decimals,
    totalSupply: contract.basics.totalSupply,
    isVibeLaunch: !!launch,
    createdAt: launch?.createdAt.toISOString() ?? row?.createdAt?.toISOString() ?? null,
    metadataUri: row?.metadataUri ?? null,
    launch: launch
      ? {
          deploymentId: launch.deploymentId,
          factory: getAddress(launch.factoryAddress),
          launchId: launch.launchId,
          curve: launch.curveAddress ? getAddress(launch.curveAddress) : null,
          pairCurrency: launch.pairCurrency,
          txHash: launch.txHash,
          blockNumber: launch.blockNumber.toString(),
          createdAt: launch.createdAt.toISOString(),
          status: launch.status,
          graduatedAt: launch.graduatedAt?.toISOString() ?? null,
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
          evidence: { source: "VibeProof indexer", method: "Launch events emitted by vibe/vibe factories, grouped by launcher address", observedAt, contract: launch!.factoryAddress },
        }
      : null,
    activity,
    proof: await getProofSection(a),
    recent,
    topHolders,
    indexer: { indexedThrough: cursor?.toString() ?? null, covered, queued },
    observedAt,
    demo: false,
  };
}

export async function getTokenPassport(address: Address): Promise<{ passport: TokenPassport | null; cached: boolean }> {
  if (isDemoMode()) return { passport: demoPassport(address), cached: false };
  const { value, cached: hit } = await cached(`passport:v1:${address.toLowerCase()}`, { ttl: 20, swr: 120 }, () => buildPassport(address));
  return { passport: value, cached: hit };
}

export const invalidatePassport = (address: string) => invalidate(`passport:v1:${address.toLowerCase()}`);

export type SeriesPoint = { t: string; transfers: number; buys: number; sells: number };

/** Hourly (≤7d) or daily buckets of indexed events. Buckets with no rows are zero *because the range is covered*. */
export async function getActivitySeries(address: Address, days = 7): Promise<SeriesPoint[] | null> {
  if (isDemoMode()) {
    const base = Date.parse("2026-09-30T12:00:00Z");
    return Array.from({ length: 48 }, (_, i) => {
      const w = Math.round(12 + 10 * Math.sin(i / 4) + (i % 7) * 2 + i * 0.6);
      return { t: new Date(base - (47 - i) * 3600_000).toISOString(), transfers: w, buys: Math.round(w * 0.7), sells: Math.round(w * 0.2) };
    });
  }
  const db = getDb();
  if (!db) return null;
  const a = address.toLowerCase();
  const tok = await db.query.tokens.findFirst({ where: and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, a)) });
  // Zero-filled buckets are only honest when the token's full history is indexed.
  if (!tok?.activityCovered) return null;
  const rows = await db.execute<{ bucket: Date; transfers: string; buys: string; sells: string }>(sql`
    with e as (
      select date_trunc('hour', timestamp) as bucket,
        count(*) filter (where event_type = 'transfer') as transfers,
        count(*) filter (where event_type = 'buy') as buys,
        count(*) filter (where event_type = 'sell') as sells
      from ${transactionEvents}
      where chain_id = ${CHAIN_ID} and token_address = ${a} and timestamp > now() - make_interval(days => ${days})
      group by 1
    )
    select g.bucket, coalesce(e.transfers, 0) as transfers, coalesce(e.buys, 0) as buys, coalesce(e.sells, 0) as sells
    from generate_series(
      date_trunc('hour', greatest(now() - make_interval(days => ${days}), coalesce(${tok.createdAt}::timestamptz, now() - make_interval(days => ${days})))),
      date_trunc('hour', now()), interval '1 hour') as g(bucket)
    left join e on e.bucket = g.bucket
    order by 1`);
  return [...rows].map((r) => ({ t: new Date(r.bucket).toISOString(), transfers: Number(r.transfers), buys: Number(r.buys), sells: Number(r.sells) }));
}

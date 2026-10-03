import { getAddress, type Address } from "viem";
import { VIBE_EVENTS, TRANSFER_EVENT } from "@/lib/vibe/abis";
import type { LaunchpadDeployment } from "@/lib/launchpads/types";
import type { DB } from "@/lib/db/client";
import { FakeProvider } from "./fake-provider";

/** Shared test scenario: v6 + v5 factories with launches, transfers, trades, completion and graduation. */
export const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`) as Address;
export const ZERO = "0x0000000000000000000000000000000000000000" as Address;
export const F6 = A(0xf6);
export const F5 = A(0xf5);
export const CREATOR = A(0xc0001);
export const W = (i: number) => A(0xb000 + i);

export function deployments(chainId = 46630): LaunchpadDeployment[] {
  const base = { launchpad: "vibe", chainId, protocolContracts: { poolManager: A(0x9999) }, enabled: true, provenance: { source: "unknown" as const, references: ["test"], verifiedAt: null, sourceVerified: null } };
  return [
    { ...base, id: "v6-test", version: "v6", factory: F6, startBlock: 1n },
    { ...base, id: "v5-test", version: "v5", factory: F5, startBlock: 1n },
  ];
}

export const opts = (extra: Record<string, unknown> = {}) => ({ confirmations: 0n, analyzePerTick: 0, snapshotEveryMs: 0, metadata: false as const, ...extra });

export function launchV6(p: FakeProvider, token: Address, curve: Address, block: bigint, launchId: bigint, name = `Token ${launchId}`, pair: Address = ZERO) {
  return p.push(F6, VIBE_EVENTS.LaunchCreated, { launchId, launcher: CREATOR, token }, { curve, name, symbol: `T${launchId}`, metadataURI: `ipfs://bafkreif63yr2ajjz5rfzccmuf45ts6taqks2k3rsdd3cpkmzw2kwyqlx2a`, pairCurrency: pair, taxBps: 100, packedWeights: 0n, projectTreasury: CREATOR, targetPairUnits: 0n, netPersonal: 0n, giftNetTotal: 0n, giftRoot: `0x${"0".repeat(64)}`, giftCount: 0n }, block);
}
export function launchV5(p: FakeProvider, token: Address, curve: Address, block: bigint, launchId: bigint, quote?: Address) {
  const data = { creator: CREATOR, creatorFeeRecipient: CREATOR, creatorVault: CREATOR, initialBuy: 0n, initialTokensBought: 0n, metadataSchemaVersion: 1, metadataDigest: "0x44784491074d340cbe4df249ca06def89a2045db04daa5fe033c083d3920234a", metadataURI: "ipfs://bafkreif63yr2ajjz5rfzccmuf45ts6taqks2k3rsdd3cpkmzw2kwyqlx2a" };
  if (quote) return p.push(F5, VIBE_EVENTS.TokenLaunchedQuoted, { launchId, token, curve }, { ...data, quoteCurrency: quote }, block);
  return p.push(F5, VIBE_EVENTS.TokenLaunched, { launchId, token, curve }, data, block);
}
export const transfer = (p: FakeProvider, token: Address, from: Address, to: Address, value: bigint, block: bigint) => p.push(token, TRANSFER_EVENT, { from, to }, { value }, block);
export const curveBuy = (p: FakeProvider, curve: Address, buyer: Address, tokens: bigint, cost: bigint, block: bigint) =>
  p.push(curve, VIBE_EVENTS.CurveBuy, { buyer, recipient: buyer }, { grossTokens: tokens, netTokens: tokens, tokenFee: 0n, pairCost: cost, pairFee: 0n, rateBps: 0n }, block);
export const curveSell = (p: FakeProvider, curve: Address, seller: Address, tokens: bigint, proceeds: bigint, block: bigint) =>
  p.push(curve, VIBE_EVENTS.CurveSell, { seller, recipient: seller }, { grossTokens: tokens, netTokens: tokens, tokenFee: 0n, pairProceeds: proceeds, pairFee: 0n }, block);
export const v5Bought = (p: FakeProvider, curve: Address, buyer: Address, tokens: bigint, eth: bigint, block: bigint) =>
  p.push(curve, VIBE_EVENTS.Bought, { buyer, recipient: buyer }, { grossEthUsed: eth, curveQuote: eth, tokenAmount: tokens, creatorFee: 0n, protocolFee: 0n }, block);
export const v5Sold = (p: FakeProvider, curve: Address, seller: Address, tokens: bigint, eth: bigint, block: bigint) =>
  p.push(curve, VIBE_EVENTS.Sold, { seller }, { tokenAmount: tokens, grossCurveQuote: eth, ethReceived: eth, creatorFee: 0n, protocolFee: 0n }, block);
export const curveCompleted = (p: FakeProvider, curve: Address, block: bigint) => p.push(curve, VIBE_EVENTS.CurveCompleted, {}, { netEthReserve: 5n, timestamp: 1n }, block);
export const graduatedV5 = (p: FakeProvider, curve: Address, block: bigint) => p.push(curve, VIBE_EVENTS.Graduated, { poolId: `0x${"ab".repeat(32)}` }, { ethAmount: 5n, tokenAmount: 7n }, block);
export const graduatedV6 = (p: FakeProvider, curve: Address, block: bigint) => p.push(curve, VIBE_EVENTS.GraduatedV6, { poolId: `0x${"cd".repeat(32)}` }, { pairAmount: 5n, tokenAmount: 7n, leftoverBurned: 0n }, block);

/** Tokens/curves used by buildChain. */
export const T = { old6: A(0xa001), new6: A(0xa002), old5: A(0xa003), new5: A(0xa004), quoted5: A(0xa005) };
export const C = { old6: A(0xc001), new6: A(0xc002), old5: A(0xc003), new5: A(0xc004), quoted5: A(0xc005) };

/**
 * Head 1000. With activity start 400: old* tokens are historical (backfilled), new* are tailed.
 *  - old6: launch@100, mint to curve, buys/sells, a wallet-to-wallet transfer, graduation@350
 *  - old5: launch@120 (v5 ETH), Bought/Sold, CurveCompleted@380 (NOT graduation)
 *  - quoted5: launch@130 via TokenLaunchedQuoted (non-ETH quote → volume unavailable)
 *  - new6: launch@500, activity through 900, graduated@950
 *  - new5: launch@600, CurveCompleted@700 then Graduated@710
 */
export function buildChain(p: FakeProvider) {
  p.head = 1_000n;
  launchV6(p, T.old6, C.old6, 100n, 1n);
  transfer(p, T.old6, ZERO, C.old6, 1_000_000n, 100n);
  transfer(p, T.old6, C.old6, W(1), 100n, 150n);
  curveBuy(p, C.old6, W(1), 100n, 10n, 150n);
  transfer(p, T.old6, C.old6, W(2), 50n, 160n);
  curveBuy(p, C.old6, W(2), 50n, 5n, 160n);
  transfer(p, T.old6, W(2), C.old6, 20n, 200n);
  curveSell(p, C.old6, W(2), 20n, 2n, 200n);
  transfer(p, T.old6, W(1), W(3), 40n, 250n);
  transfer(p, T.old6, C.old6, A(0x9999), 999_000n, 350n); // liquidity to the pool manager on graduation
  graduatedV6(p, C.old6, 350n);
  transfer(p, T.old6, W(3), W(4), 1n, 450n); // after start: tail must pick this up once covered

  launchV5(p, T.old5, C.old5, 120n, 7n);
  transfer(p, T.old5, ZERO, C.old5, 500n, 120n);
  transfer(p, T.old5, C.old5, W(5), 30n, 140n);
  v5Bought(p, C.old5, W(5), 30n, 3n, 140n);
  transfer(p, T.old5, W(5), C.old5, 10n, 300n);
  v5Sold(p, C.old5, W(5), 10n, 1n, 300n);
  curveCompleted(p, C.old5, 380n);

  launchV5(p, T.quoted5, C.quoted5, 130n, 8n, A(0x5a53));
  transfer(p, T.quoted5, ZERO, C.quoted5, 100n, 130n);
  transfer(p, T.quoted5, C.quoted5, W(6), 10n, 135n);
  curveBuy(p, C.quoted5, W(6), 10n, 1n, 135n); // v6-style event on a quoted curve still decodes as a trade

  launchV6(p, T.new6, C.new6, 500n, 2n);
  transfer(p, T.new6, ZERO, C.new6, 1_000n, 500n);
  transfer(p, T.new6, C.new6, W(1), 100n, 700n);
  curveBuy(p, C.new6, W(1), 100n, 40n, 700n);
  transfer(p, T.new6, C.new6, CREATOR, 5n, 800n);
  curveBuy(p, C.new6, CREATOR, 5n, 2n, 800n); // creator activity
  transfer(p, T.new6, W(1), W(7), 100n, 900n); // W1 exits
  graduatedV6(p, C.new6, 950n);

  launchV5(p, T.new5, C.new5, 600n, 9n);
  transfer(p, T.new5, ZERO, C.new5, 100n, 600n);
  transfer(p, T.new5, C.new5, W(8), 7n, 650n);
  v5Bought(p, C.new5, W(8), 7n, 1n, 650n);
  curveCompleted(p, C.new5, 700n);
  graduatedV5(p, C.new5, 710n);
}

/** Deterministic snapshot of everything the indexer derives (excluding wall-clock bookkeeping columns). */
export async function snapshot(db: DB, chainId = 46630) {
  const { sql } = await import("drizzle-orm");
  const q = async (s: ReturnType<typeof sql>) => JSON.parse(JSON.stringify([...(await db.execute(s))], (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  return {
    holders: await q(sql`select token_address, wallet_address, balance::text from holders where chain_id = ${chainId} order by 1, 2`),
    events: await q(sql`select tx_hash, log_index, block_number::text, token_address, wallet_address, counterparty, event_type, event_name, amount::text, quote_amount::text from transaction_events where chain_id = ${chainId} order by block_number, log_index`),
    tokens: await q(sql`select address, name, symbol, decimals, total_supply::text, activity_covered, holder_count, transfer_count, buy_count, sell_count, unique_buyers, unique_sellers, volume_wei::text, last_activity_at from tokens where chain_id = ${chainId} order by 1`),
    launches: await q(sql`select token_address, deployment_id, event_name, status, graduated_tx, graduated_block::text, curve_completed_at, pair_currency from launches where chain_id = ${chainId} order by 1`),
    feed: await q(sql`select kind, token_address, tx_hash, block_number::text from feed_events where chain_id = ${chainId} order by 2, 1, 3`),
    creators: await q(sql`select address, launch_count, graduated_launch_count from creators where chain_id = ${chainId} order by 1`),
  };
}

export async function resetDb(db: DB) {
  const { sql } = await import("drizzle-orm");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrate(db, { migrationsFolder: "./drizzle" });
}

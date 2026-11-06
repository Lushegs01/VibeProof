import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb, getSql, schema } from "@/lib/db/client";
import { VibeIndexer } from "@/indexer/indexer";
import { writeCheckpoint } from "@/indexer/blocks";
import { FakeProvider } from "./fake-provider";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@127.0.0.1:5432/vibeproof_test";
const db = getDb()!;
beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw Error("Disposable test database required");
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.execute(sql`truncate chain_blocks,indexer_state,transaction_events,holders,launches,tokens,feed_events restart identity cascade`);
});
afterAll(async () => {
  await db.execute(sql`drop function if exists vp_test_reorg_failure() cascade`);
  await getSql()?.end();
});
describe.runIf(process.env.SKIP_DB_TESTS !== "1")("reorg monitoring with transactional rollback", () => {
  it("retains all data on transaction failure, then recovers and reports distinct failure/success counters", async () => {
    const provider = new FakeProvider(),
      indexer = new VibeIndexer(provider, db, { metadata: false, analyzePerTick: 0, tokenMetaRepairPerTick: 0 });
    const token = `0x${"9".repeat(40)}`,
      wallet = `0x${"8".repeat(40)}`,
      now = new Date();
    await writeCheckpoint(db, 46630, await provider.getBlock({ blockNumber: 500n }));
    await writeCheckpoint(db, 46630, await provider.getBlock({ blockNumber: 1000n }));
    await db.insert(schema.indexerState).values([
      { key: "activity_start:46630", lastBlock: 1n },
      { key: "activity:46630", lastBlock: 1000n },
    ]);
    await db.insert(schema.tokens).values({ chainId: 46630, address: token, isVibeLaunch: true, activityCovered: true, createdBlock: 100n });
    await db.insert(schema.holders).values({ chainId: 46630, tokenAddress: token, walletAddress: wallet, balance: "10", firstSeenAt: now, lastUpdatedAt: now });
    await db.insert(schema.transactionEvents).values({
      chainId: 46630,
      tokenAddress: token,
      walletAddress: wallet,
      counterparty: `0x${"0".repeat(40)}`,
      amount: "10",
      eventType: "transfer",
      blockNumber: 950n,
      blockHash: provider.hashOf(950n),
      txHash: `0x${"6".repeat(64)}`,
      logIndex: 0,
      timestamp: now,
    });
    provider.reorg(900n);
    await db.execute(
      sql`create function vp_test_reorg_failure() returns trigger language plpgsql as $$ begin raise exception 'simulated rollback database failure'; end; $$`,
    );
    await db.execute(sql`create trigger vp_test_reorg_failure before update on indexer_state for each row execute function vp_test_reorg_failure()`);
    try {
      await expect(indexer.checkReorg(provider.head)).rejects.toThrow("Reorg recovery failed");
      expect(await db.select().from(schema.transactionEvents)).toHaveLength(1);
      expect((await db.select().from(schema.holders))[0].balance).toBe("10");
      expect((await db.select().from(schema.indexerState).where(eq(schema.indexerState.key, "activity:46630")))[0].lastBlock).toBe(1000n);
    } finally {
      await db.execute(sql`drop function vp_test_reorg_failure() cascade`);
    }
    await indexer.heartbeat({ ok: false, error: "Reorg recovery failed" });
    expect((await db.select().from(schema.indexerStatus))[0].stats).toMatchObject({
      monitoring: { detected: 1, recovered: 0, failed: 1, transactionFailures: 1 },
    });
    expect(await indexer.checkReorg(provider.head)).toBe(500n);
    expect(await db.select().from(schema.transactionEvents)).toHaveLength(0);
    expect((await db.select().from(schema.holders).where(eq(schema.holders.walletAddress, wallet)))[0].balance).toBe("0");
    expect((await db.select().from(schema.indexerState).where(eq(schema.indexerState.key, "activity:46630")))[0].lastBlock).toBe(500n);
    expect((await db.select().from(schema.indexerStatus))[0].stats).toMatchObject({
      monitoring: { detected: 2, recovered: 1, failed: 1, transactionFailures: 1 },
    });
  });
});

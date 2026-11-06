import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getAddress, type Address } from "viem";
import { FakeProvider } from "./fake-provider";

/** Serverless job safety: advisory lock exclusivity, tail clamped to launch cursors, bounded runs. */
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@localhost:5432/vibeproof_test";
process.env.REDIS_URL = "";

const F1 = getAddress("0x00000000000000000000000000000000000f0001");
const F2 = getAddress("0x00000000000000000000000000000000000f0002");
const CREATOR = getAddress("0x00000000000000000000000000000000000c0001");
const TOKEN = getAddress("0x000000000000000000000000000000000000a0b1");
const CURVE = getAddress("0x000000000000000000000000000000000000c0b1");

const load = async () => {
  const [db, job, idx, abis, contracts, drizzle, migrator] = await Promise.all([
    import("@/lib/db/client"),
    import("@/indexer/job"),
    import("@/indexer/indexer"),
    import("@/lib/vibe/abis"),
    import("@/lib/vibe/contracts"),
    import("drizzle-orm"),
    import("drizzle-orm/postgres-js/migrator"),
  ]);
  return { ...db, ...job, ...idx, ...abis, ...contracts, drizzle, migrator };
};
let m: Awaited<ReturnType<typeof load>>;

beforeAll(async () => {
  m = await load();
  const db = m.getDb()!;
  await db.execute(m.drizzle.sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await m.migrator.migrate(db, { migrationsFolder: "./drizzle" });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await m?.getSql()?.end();
});

describe.runIf(process.env.SKIP_DB_TESTS !== "1")("serverless indexer job", () => {
  it("allows only one indexer to hold the lock", async () => {
    const inner = await m.withIndexerLock(async () => m.withIndexerLock(async () => "second"));
    expect(inner).toBeNull();
    expect(await m.withIndexerLock(async () => "free again")).toBe("free again");
  });

  it("never advances the activity tail past a deployment whose launches are behind", async () => {
    const db = m.getDb()!;
    const p = new FakeProvider();
    const deps = [
      { ...m.VIBE_DEPLOYMENTS[0], id: "a", factory: F1 as Address, startBlock: 1n },
      { ...m.VIBE_DEPLOYMENTS[0], id: "b", factory: F2 as Address, startBlock: 1n },
    ];
    // Launch on the lagging factory at block 900, with a transfer at 950.
    p.push(
      F2,
      m.VIBE_EVENTS.LaunchCreated,
      { launchId: 1n, launcher: CREATOR, token: TOKEN },
      {
        curve: CURVE,
        name: "B",
        symbol: "B",
        metadataURI: "",
        pairCurrency: "0x0000000000000000000000000000000000000000",
        taxBps: 0,
        packedWeights: 0n,
        projectTreasury: CREATOR,
        targetPairUnits: 0n,
        netPersonal: 0n,
        giftNetTotal: 0n,
        giftRoot: `0x${"0".repeat(64)}`,
        giftCount: 0n,
      },
      900n,
    );
    p.push(TOKEN, m.TRANSFER_EVENT, { from: "0x0000000000000000000000000000000000000000", to: CREATOR }, { value: 5n }, 950n);
    const { indexerState } = m.schema;
    await db.insert(indexerState).values([
      { key: "launches:46630:a", lastBlock: 1000n },
      { key: "launches:46630:b", lastBlock: 500n },
      { key: "activity_start:46630", lastBlock: 400n },
      { key: "activity:46630", lastBlock: 399n },
    ]);
    // First shouldStop() check happens in deployment b's launch loop → b stays at 500 this tick.
    let calls = 0;
    const idx = new m.VibeIndexer(
      p as never,
      db,
      { shouldStop: () => ++calls === 1, snapshotEveryMs: 0, confirmations: 0n, metadata: false, analyzePerTick: 0 },
      deps,
    );
    const r = await idx.tick();
    expect(r.activityThrough).toBe(500n);

    // Next tick catches launches up; the token is covered and its transfer is not lost.
    const idx2 = new m.VibeIndexer(p as never, db, { snapshotEveryMs: 0, confirmations: 0n, metadata: false, analyzePerTick: 0 }, deps);
    const r2 = await idx2.tick();
    expect(r2.activityThrough).toBe(1000n);
    const [t] = await db.select().from(m.schema.tokens).where(m.drizzle.eq(m.schema.tokens.address, TOKEN.toLowerCase()));
    expect(t.activityCovered).toBe(true);
    expect(t.transferCount).toBe(1);
    expect(t.holderCount).toBe(1);
  });

  it("runIndexerJob returns a bounded result and skips when locked", async () => {
    const skipped = await m.withIndexerLock(() => m.runIndexerJob({ budgetMs: 1_000 }));
    expect(skipped).toEqual({ status: "skipped", reason: "another indexer run holds the lock" });
  });
  it("fails when all configured network jobs fail and keeps aggregate head unknown", async () => {
    const provider = await import("@/lib/chain/provider");
    vi.spyOn(provider, "getProvider").mockReturnValue(new FakeProvider() as never);
    vi.spyOn(m.VibeIndexer.prototype, "tick").mockRejectedValue(new Error("RPC timeout"));
    const result = await m.runIndexerJob({ budgetMs: 1000, networks: ["robinhood-testnet"] });
    expect(result.status).toBe("failed");
    if (result.status !== "skipped") {
      expect(result.head).toBeNull();
      expect(result.networks[0].status).toBe("error");
    }
  });
  it("retains completed work when a later tick fails", async () => {
    const provider = await import("@/lib/chain/provider");
    vi.spyOn(provider, "getProvider").mockReturnValue(new FakeProvider() as never);
    vi.spyOn(m.VibeIndexer.prototype, "tick")
      .mockResolvedValueOnce({
        head: 100n,
        safeHead: 100n,
        activityThrough: 50n,
        launchesThrough: 100n,
        newLaunches: 1,
        newEvents: 2,
        backfilled: 0,
        backfillFailed: 0,
        metadataFetched: 0,
        reorg: { detected: false, ancestor: null },
      })
      .mockRejectedValueOnce(new Error("later RPC failure"));
    const result = await m.runIndexerJob({ budgetMs: 1000, networks: ["robinhood-testnet"] });
    expect(result.status).toBe("partial_success");
    if (result.status !== "skipped") {
      expect(result.newLaunches).toBe(1);
      expect(result.newEvents).toBe(2);
      expect(result.activityThrough).toBe("50");
    }
  });
  it("counts a failed metadata document once and reports partial execution", async () => {
    const provider = await import("@/lib/chain/provider");
    vi.spyOn(provider, "getProvider").mockReturnValue(new FakeProvider() as never);
    vi.spyOn(m.VibeIndexer.prototype, "tick")
      .mockResolvedValueOnce({
        head: 100n,
        safeHead: 100n,
        activityThrough: 100n,
        launchesThrough: 100n,
        newLaunches: 0,
        newEvents: 0,
        backfilled: 0,
        backfillFailed: 0,
        metadataFetched: 2,
        metadataFailed: 1,
        failures: ["1 metadata job(s) failed"],
        reorg: { detected: false, ancestor: null },
      })
      .mockResolvedValue({
        head: 100n,
        safeHead: 100n,
        activityThrough: 100n,
        launchesThrough: 100n,
        newLaunches: 0,
        newEvents: 0,
        backfilled: 0,
        backfillFailed: 0,
        metadataFetched: 0,
        reorg: { detected: false, ancestor: null },
      });
    const result = await m.runIndexerJob({ budgetMs: 1000, networks: ["robinhood-testnet"] });
    expect(result.status).toBe("partial_success");
    if (result.status !== "skipped") {
      expect(result.failedJobs).toBe(1);
      expect(result.metadataProcessed).toBe(2);
      expect(result.metadataFailed).toBe(1);
    }
  });
});

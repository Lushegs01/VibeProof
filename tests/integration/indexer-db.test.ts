import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import { FakeProvider } from "./fake-provider";

/**
 * End-to-end write path against a real Postgres (DATABASE_URL_TEST, default vibeproof_test):
 * launch events → tokens/launches/creators; transfers + curve trades → events, holders, counters,
 * snapshots; per-token backfill; idempotency; proof authorization + storage; creator history.
 */
const TEST_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@localhost:5432/vibeproof_test";
process.env.DATABASE_URL = TEST_URL;
process.env.REDIS_URL = "";

const FACTORY = "0xe794217880011f9cA6961340eD5c16EC9559Fea0" as Address;
const CREATOR = getAddress("0x00000000000000000000000000000000000c0001");
const OTHER = getAddress("0x00000000000000000000000000000000000c0002");
const TOKEN_NEW = getAddress("0x000000000000000000000000000000000000a001");
const CURVE_NEW = getAddress("0x000000000000000000000000000000000000c001");
const TOKEN_OLD = getAddress("0x000000000000000000000000000000000000a002");
const CURVE_OLD = getAddress("0x000000000000000000000000000000000000c002");
const W1 = getAddress("0x0000000000000000000000000000000000000b01");
const W2 = getAddress("0x0000000000000000000000000000000000000b02");
const ZERO = "0x0000000000000000000000000000000000000000";

let reachable = true;
let mods: Awaited<ReturnType<typeof load>>;
async function load() {
  const [{ getDb, getSql, schema }, { VibeIndexer }, { VIBE_EVENTS, TRANSFER_EVENT }, { VIBE_DEPLOYMENTS }, drizzle, migrator, proof, creator, token] = await Promise.all([
    import("@/lib/db/client"),
    import("@/indexer/indexer"),
    import("@/lib/vibe/abis"),
    import("@/lib/vibe/contracts"),
    import("drizzle-orm"),
    import("drizzle-orm/postgres-js/migrator"),
    import("@/lib/services/proof-service"),
    import("@/lib/services/creator-service"),
    import("@/lib/services/token-service"),
  ]);
  return { getDb, getSql, schema, VibeIndexer, VIBE_EVENTS, TRANSFER_EVENT, VIBE_DEPLOYMENTS, drizzle, migrator, proof, creator, token };
}

const p = new FakeProvider();

function launch(token: Address, curve: Address, block: bigint, launchId: bigint) {
  p.push(FACTORY, mods.VIBE_EVENTS.LaunchCreated, { launchId, launcher: CREATOR, token }, { curve, name: `Token ${launchId}`, symbol: `T${launchId}`, metadataURI: "ipfs://x", pairCurrency: ZERO, taxBps: 100, packedWeights: 0n, projectTreasury: CREATOR, targetPairUnits: 0n, netPersonal: 0n, giftNetTotal: 0n, giftRoot: `0x${"0".repeat(64)}`, giftCount: 0n }, block);
}
const transfer = (token: Address, from: string, to: string, value: bigint, block: bigint) => p.push(token, mods.TRANSFER_EVENT, { from, to }, { value }, block);
const buy = (curve: Address, buyer: Address, tokens: bigint, cost: bigint, block: bigint) =>
  p.push(curve, mods.VIBE_EVENTS.CurveBuy, { buyer, recipient: buyer }, { grossTokens: tokens, netTokens: tokens, tokenFee: 0n, pairCost: cost, pairFee: 0n, rateBps: 0n }, block);

beforeAll(async () => {
  mods = await load();
  const db = mods.getDb()!;
  try {
    await db.execute(mods.drizzle.sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await mods.migrator.migrate(db, { migrationsFolder: "./drizzle" });
  } catch {
    reachable = false;
    return;
  }
  // Old launch (before activity start) with history, new launch after start.
  launch(TOKEN_OLD, CURVE_OLD, 100n, 1n);
  transfer(TOKEN_OLD, ZERO, CURVE_OLD, 1000n, 100n);
  transfer(TOKEN_OLD, CURVE_OLD, W1, 10n, 150n);
  buy(CURVE_OLD, W1, 10n, 5n, 150n);
  launch(TOKEN_NEW, CURVE_NEW, 600n, 2n);
  transfer(TOKEN_NEW, ZERO, CURVE_NEW, 1000n, 600n);
  transfer(TOKEN_NEW, CURVE_NEW, W1, 100n, 700n);
  buy(CURVE_NEW, W1, 100n, 40n, 700n);
  transfer(TOKEN_NEW, CURVE_NEW, W2, 50n, 710n);
  buy(CURVE_NEW, W2, 50n, 20n, 710n);
  transfer(TOKEN_NEW, W2, W1, 50n, 800n); // W2 exits fully
  buy(CURVE_NEW, CREATOR, 1n, 1n, 900n); // creator activity
  transfer(TOKEN_NEW, CURVE_NEW, CREATOR, 1n, 900n);
  transfer(TOKEN_OLD, W1, W2, 4n, 950n); // old token activity after start (must be ignored until backfilled)
});

afterAll(async () => {
  await mods?.getSql()?.end();
});

describe.runIf(process.env.SKIP_DB_TESTS !== "1")("indexer → Postgres", () => {
  it("indexes launches, tail activity, holders and counters", async () => {
    if (!reachable) return;
    const db = mods.getDb()!;
    const idx = new mods.VibeIndexer(p as never, db, { initialBackfillBlocks: 500n, snapshotEveryMs: 0 }, [{ ...mods.VIBE_DEPLOYMENTS[0], factory: FACTORY, deployBlock: 1n }]);
    const r = await idx.tick();
    expect(r.newLaunches).toBe(2);
    expect(r.activityThrough).toBe(1000n);

    const { tokens, holders, launches } = mods.schema;
    const { eq } = mods.drizzle;
    const [tNew] = await db.select().from(tokens).where(eq(tokens.address, TOKEN_NEW.toLowerCase()));
    expect(tNew.activityCovered).toBe(true);
    expect(tNew.symbol).toBe("T2");
    expect(tNew.transferCount).toBe(5);
    expect(tNew.buyCount).toBe(3);
    expect(tNew.uniqueBuyers).toBe(3);
    // Holders: W1 (150), creator (1). W2 exited, curve & zero excluded.
    expect(tNew.holderCount).toBe(2);
    expect(tNew.volumeWei).toBe("61");
    const w1 = await db.select().from(holders).where(eq(holders.walletAddress, W1.toLowerCase()));
    expect(w1.find((h) => h.tokenAddress === TOKEN_NEW.toLowerCase())?.balance).toBe("150");

    // Old token launched before activity start: NOT covered, counters unknown (null), not zero.
    const [tOld] = await db.select().from(tokens).where(eq(tokens.address, TOKEN_OLD.toLowerCase()));
    expect(tOld.activityCovered).toBe(false);
    expect(tOld.holderCount).toBeNull();
    expect(tOld.transferCount).toBeNull();

    const ls = await db.select().from(launches);
    expect(ls).toHaveLength(2);
  });

  it("is idempotent: re-processing a range never double counts", async () => {
    if (!reachable) return;
    const db = mods.getDb()!;
    const { tokens, indexerState } = mods.schema;
    const { eq } = mods.drizzle;
    await db.update(indexerState).set({ lastBlock: 500n }).where(eq(indexerState.key, "activity:46630"));
    const idx = new mods.VibeIndexer(p as never, db, { snapshotEveryMs: 0 }, [{ ...mods.VIBE_DEPLOYMENTS[0], factory: FACTORY, deployBlock: 1n }]);
    await idx.tick();
    const [tNew] = await db.select().from(tokens).where(eq(tokens.address, TOKEN_NEW.toLowerCase()));
    expect(tNew.transferCount).toBe(5);
    expect(tNew.holderCount).toBe(2);
  });

  it("backfills an old launch's complete history on request", async () => {
    if (!reachable) return;
    const db = mods.getDb()!;
    const { tokens, holders } = mods.schema;
    const { eq, and } = mods.drizzle;
    const idx = new mods.VibeIndexer(p as never, db, { snapshotEveryMs: 0 }, [{ ...mods.VIBE_DEPLOYMENTS[0], factory: FACTORY, deployBlock: 1n }]);
    await idx.enqueueBackfill(TOKEN_OLD);
    await idx.tick();
    const [tOld] = await db.select().from(tokens).where(eq(tokens.address, TOKEN_OLD.toLowerCase()));
    expect(tOld.activityCovered).toBe(true);
    expect(tOld.transferCount).toBe(3);
    expect(tOld.buyCount).toBe(1);
    expect(tOld.holderCount).toBe(2); // W1: 6, W2: 4
    const [w2] = await db.select().from(holders).where(and(eq(holders.tokenAddress, TOKEN_OLD.toLowerCase()), eq(holders.walletAddress, W2.toLowerCase())));
    expect(w2.balance).toBe("4");
  });

  it("builds observed creator history", async () => {
    if (!reachable) return;
    const { creator } = await mods.creator.getCreatorPassport(CREATOR);
    expect(creator?.launchCount).toBe(2);
    expect(creator?.launches.map((l) => l.symbol)).toEqual(["T2", "T1"]);
  });

  it("records creator curve activity in the feed", async () => {
    if (!reachable) return;
    const db = mods.getDb()!;
    const rows = await db.select().from(mods.schema.feedEvents).where(mods.drizzle.eq(mods.schema.feedEvents.kind, "creator_activity"));
    expect(rows).toHaveLength(1);
  });

  it("only lets the launch creator submit proof", async () => {
    if (!reachable) return;
    expect(await mods.proof.authorizeSubmitter(TOKEN_NEW, CREATOR)).toBe("launch_creator");
    expect(await mods.proof.authorizeSubmitter(TOKEN_NEW, OTHER)).toBeNull();
    // Non-vibe token: falls back to owner()
    const NONVIBE = getAddress("0x000000000000000000000000000000000000d00d");
    p.owners.set(NONVIBE.toLowerCase(), OTHER);
    expect(await mods.proof.authorizeSubmitter(NONVIBE, OTHER, p)).toBe("contract_owner");
    expect(await mods.proof.authorizeSubmitter(NONVIBE, CREATOR, p)).toBeNull();
  });

  it("stores proof checks and exposes the latest per type", async () => {
    if (!reachable) return;
    const db = mods.getDb()!;
    await db.insert(mods.schema.projectProofs).values({ chainId: 46630, tokenAddress: TOKEN_NEW.toLowerCase(), websiteUrl: "https://a.xyz", githubUrl: "https://github.com/o/r", submittedBy: CREATOR.toLowerCase(), submitterIsCreator: true, metadataHash: `0x${"1".repeat(64)}` });
    const ev = (t: string, state: string, at: string) => ({ type: t, url: "https://a.xyz", state, summary: "", facts: {}, evidence: { source: "test", method: "test", observedAt: at } });
    await mods.proof.storeChecks(TOKEN_NEW.toLowerCase(), [ev("website", "unavailable", "2026-09-29T00:00:00Z"), ev("github", "observed", "2026-09-29T00:00:00Z")] as never);
    await mods.proof.storeChecks(TOKEN_NEW.toLowerCase(), [ev("website", "verified", "2026-09-30T00:00:00Z")] as never);
    const section = await mods.token.getProofSection(TOKEN_NEW);
    expect(section.submitted).toBe(true);
    expect(section.checks.find((c) => c.type === "website")?.state).toBe("verified");
    expect(section.score).toEqual({ observed: 2, total: 3 });
  });

  it("stores snapshots for change detection", async () => {
    if (!reachable) return;
    const db = mods.getDb()!;
    const snaps = await db.select().from(mods.schema.activitySnapshots);
    expect(snaps.length).toBeGreaterThan(0);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_TOKENS } from "@/lib/demo/data";

/**
 * Demo mode serves fixtures only and never touches a database; live mode never returns fixtures.
 * The database URL below points at a closed port: any query would throw, so passing tests prove
 * demo mode made none.
 */
const g = globalThis as unknown as { __vpDb?: unknown; __vpSql?: unknown };
const saved = { ...process.env };

beforeEach(() => {
  delete g.__vpDb;
  delete g.__vpSql;
});
afterEach(() => {
  process.env = { ...saved };
  delete g.__vpDb;
  delete g.__vpSql;
});

describe("demo / live isolation", () => {
  it("demo mode answers from fixtures without any database access", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/never";
    const { discover, activityFeed, ecosystemStats } = await import("@/lib/services/discover-service");
    const { search } = await import("@/lib/services/search-service");
    const { getTokenPassport } = await import("@/lib/services/token-service");
    const { getCreatorPassport } = await import("@/lib/services/creator-service");
    const d = await discover("newest", "all", 10);
    expect(d.items.every((i) => i.address.toLowerCase().startsWith("0xde00"))).toBe(true);
    expect((await activityFeed(5)).length).toBeGreaterThan(0);
    expect((await ecosystemStats())?.demo).toBe(true);
    const hit = (await search("LATTICE"))[0];
    expect(hit?.kind === "token" ? hit.address : null).toBe(DEMO_TOKENS[0].addr);
    const { passport } = await getTokenPassport(DEMO_TOKENS[0].addr);
    expect(passport?.demo).toBe(true);
    expect((await getCreatorPassport(DEMO_TOKENS[0].creator)).creator?.demo).toBe(true);
    // A real (non-demo) address in demo mode is simply not found: no live lookup happens.
    expect((await getTokenPassport("0xe794217880011f9cA6961340eD5c16EC9559Fea0")).passport).toBeNull();
  });

  it("the indexer refuses to run in demo mode", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/never";
    const { runIndexerJob } = await import("@/indexer/job");
    expect(await runIndexerJob({ budgetMs: 1000 })).toEqual({ status: "skipped", reason: "demo mode never indexes live data" });
  });

  it("live mode never serves demo fixtures, even with no data", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    const { discover, activityFeed, ecosystemStats } = await import("@/lib/services/discover-service");
    const { search } = await import("@/lib/services/search-service");
    expect((await discover("newest", "all", 10)).items).toEqual([]);
    expect(await activityFeed(5)).toEqual([]);
    expect(await ecosystemStats()).toBeNull(); // unknown, not zero
    expect(await search("LATTICE")).toEqual([]);
  });
});

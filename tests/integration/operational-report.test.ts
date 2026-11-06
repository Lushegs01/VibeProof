import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
vi.mock("@/lib/services/health-service", () => ({ healthReport: vi.fn() }));
import { healthReport } from "@/lib/services/health-service";
import { monitorOperations } from "@/lib/services/operations-service";
import { getDb, getSql, schema } from "@/lib/db/client";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@127.0.0.1:5432/vibeproof_test";
const db = getDb()!;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.delete(schema.monitoringSamples);
  await db.delete(schema.operationalAlerts);
  await db.delete(schema.operationalAlertDeliveries);
  await db.delete(schema.indexerRuns);
  vi.stubEnv("ALERT_SUSTAIN_S", "0");
  vi.stubEnv("ALERT_WEBHOOK_URL", "");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await getSql()?.end();
});
describe.runIf(process.env.SKIP_DB_TESTS !== "1")("operational report persistence", () => {
  it("reads a previous-process baseline, persists the current sample and never resolves unavailable metrics", async () => {
    const old = new Date(Date.now() - 600000);
    await db.insert(schema.monitoringSamples).values({ chainId: 46630, observedAt: old, metrics: { deadLetters: 0, backfillLag: 0 } });
    const network = {
      network: "robinhood-testnet",
      chainId: 46630,
      rpc: { status: "ok", chainIdMatches: true },
      indexer: { status: "healthy", backfillQueue: { dead: 2 }, pendingBackfills: 150, metadata: { ok: 10 }, lagBlocks: 0 },
    };
    const body = { database: "ok", redis: "ok", status: "ok", networks: [network], checkedAt: new Date().toISOString() };
    vi.mocked(healthReport).mockResolvedValue({ body, httpStatus: 200 } as unknown as Awaited<ReturnType<typeof healthReport>>);
    const report = await monitorOperations();
    expect(report.samples[0].observedAt).toBe(old.toISOString());
    expect(await db.select().from(schema.monitoringSamples)).toHaveLength(2);
    const alert = () => db.select().from(schema.operationalAlerts).where(eq(schema.operationalAlerts.key, "robinhood-testnet:dead_letter_growth"));
    expect((await alert())[0].state).toMatchObject({ active: true });
    vi.mocked(healthReport).mockResolvedValue({
      body: { ...body, networks: [{ ...network, indexer: { status: "unavailable" } }] },
      httpStatus: 503,
    } as unknown as Awaited<ReturnType<typeof healthReport>>);
    await monitorOperations();
    expect((await alert())[0].state).toMatchObject({ active: true });
    // A failed delivery remains degraded during backoff, even when no retry is due this tick.
    await db.insert(schema.operationalAlertDeliveries).values({
      id: crypto.randomUUID(),
      alertKey: "receiver",
      payload: {},
      lastError: "Alert delivery HTTP 503",
      nextAttemptAt: new Date(Date.now() + 3600000),
    });
    expect((await monitorOperations()).monitoringStatus).toBe("degraded");
  });
});

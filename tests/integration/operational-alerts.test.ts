import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb, getSql, schema } from "@/lib/db/client";
import { evaluateAlert } from "@/lib/services/alert-service";
import { deliverOperationalAlerts } from "@/lib/services/alert-delivery";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@127.0.0.1:5432/vibeproof_test";
const db = getDb()!;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  vi.stubEnv("ALERT_SUSTAIN_S", "0");
  vi.stubEnv("ALERT_COOLDOWN_S", "3600");
  await db.delete(schema.operationalAlertDeliveries);
  await db.delete(schema.operationalAlerts);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await getSql()?.end();
});
describe.runIf(process.env.SKIP_DB_TESTS !== "1")("durable operational alerts", () => {
  it("queues one concurrent transition, preserves unknown incidents and commits recovery in order", async () => {
    await Promise.all(Array.from({ length: 8 }, () => evaluateAlert("queue_race", true, "critical")));
    expect(await db.select().from(schema.operationalAlertDeliveries)).toHaveLength(1);
    await evaluateAlert("queue_race", null);
    expect((await db.select().from(schema.operationalAlerts))[0].state).toMatchObject({ active: true });
    await evaluateAlert("queue_race", false);
    const events: string[] = [];
    const adapter = {
      deliver: vi.fn(async (event: { kind: string }) => {
        events.push(event.kind);
      }),
    };
    await Promise.all([deliverOperationalAlerts(2, adapter), deliverOperationalAlerts(2, adapter)]);
    expect(events).toEqual(["firing", "recovered"]);
    expect((await db.select().from(schema.operationalAlertDeliveries)).every((r) => r.status === "delivered")).toBe(true);
  });
  it("retries with the same ID, blocks recovery behind pending firing and exhausts into dead state", async () => {
    await evaluateAlert("retry_fixture", true);
    await evaluateAlert("retry_fixture", false);
    const sent: string[] = [];
    const adapter = {
      deliver: vi.fn(async (_event: unknown, id?: string) => {
        sent.push(id!);
        throw Error("Secret receiver error must not be stored");
      }),
    };
    await deliverOperationalAlerts(2, adapter);
    expect(sent).toHaveLength(1);
    let [row] = await db
      .select()
      .from(schema.operationalAlertDeliveries)
      .where(eq(schema.operationalAlertDeliveries.alertKey, "retry_fixture"))
      .orderBy(schema.operationalAlertDeliveries.sequence);
    expect(row).toMatchObject({ attempts: 1, status: "pending", lastError: "Alert transport/configuration unavailable" });
    for (let n = 1; n < 8; n++) {
      await db
        .update(schema.operationalAlertDeliveries)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(schema.operationalAlertDeliveries.id, row.id));
      await deliverOperationalAlerts(1, adapter);
    }
    expect(new Set(sent).size).toBe(1);
    [row] = await db.select().from(schema.operationalAlertDeliveries).where(eq(schema.operationalAlertDeliveries.id, row.id));
    expect(row.status).toBe("dead");
    const recovered = vi.fn(async () => {});
    await deliverOperationalAlerts(1, { deliver: recovered });
    expect(recovered).toHaveBeenCalledWith(expect.objectContaining({ kind: "recovered" }), expect.any(String));
  });
  it("reclaims expired leases and fences a late acknowledgement from an earlier worker", async () => {
    await evaluateAlert("lease_fixture", true);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = deliverOperationalAlerts(1, {
      deliver: async () => {
        entered();
        await blocked;
      },
    });
    await started;
    await db.execute(sql`update operational_alert_deliveries set next_attempt_at=now()-interval '1 minute' where alert_key='lease_fixture'`);
    await deliverOperationalAlerts(1, {
      deliver: async () => {
        throw Error("retry");
      },
    });
    release();
    await first;
    const [row] = await db.select().from(schema.operationalAlertDeliveries).where(eq(schema.operationalAlertDeliveries.alertKey, "lease_fixture"));
    expect(row).toMatchObject({ status: "pending", attempts: 2, leaseToken: null });
  });
  it("does not send a ninth request after eight interrupted leases", async () => {
    await db.delete(schema.operationalAlertDeliveries);
    await evaluateAlert("crash_budget_fixture", true);
    await db
      .update(schema.operationalAlertDeliveries)
      .set({ status: "processing", attempts: 8, nextAttemptAt: new Date(0) })
      .where(eq(schema.operationalAlertDeliveries.alertKey, "crash_budget_fixture"));
    const deliver = vi.fn(async () => {});
    const result = await deliverOperationalAlerts(1, { deliver });
    expect(deliver).not.toHaveBeenCalled();
    expect(result.exhausted).toBe(1);
    expect((await db.select().from(schema.operationalAlertDeliveries))[0].status).toBe("dead");
  });
});

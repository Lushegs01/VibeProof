import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { getDb, schema } from "../db/client";
import { PLANS, effectivePlan } from "./plans";
import { ProofError } from "../services/proof-service";
export async function accountEntitlements(wallet: string, db: DB = getDb()!) {
  if (!db) throw new ProofError(503, "db_unavailable", "Account storage unavailable.");
  const [row] = await db.select().from(schema.accountPlans).where(eq(schema.accountPlans.wallet, wallet.toLowerCase()));
  const plan = effectivePlan(row?.plan ?? "free", row?.subscriptionState ?? "inactive");
  return { plan, subscriptionState: row?.subscriptionState ?? "inactive", limits: PLANS[plan] };
}
/** Account lock serializes subscription updates and capacity changes within one transaction. */
export async function lockAccount(tx: DB, wallet: string) {
  await tx.insert(schema.accountPlans).values({ wallet: wallet.toLowerCase() }).onConflictDoNothing();
  await tx.select().from(schema.accountPlans).where(eq(schema.accountPlans.wallet, wallet.toLowerCase())).for("update");
}
export async function consumeApiUsage(wallet: string) {
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Usage accounting unavailable.");
  return db.transaction(async (tx) => {
    await lockAccount(tx as unknown as DB, wallet);
    const account = await accountEntitlements(wallet, tx as unknown as DB);
    const period = new Date().toISOString().slice(0, 7);
    const metric = "api";
    const [used] = await tx
      .insert(schema.usageCounters)
      .values({ wallet, metric, period, used: 1 })
      .onConflictDoUpdate({
        target: [schema.usageCounters.wallet, schema.usageCounters.metric, schema.usageCounters.period],
        set: { used: sql`${schema.usageCounters.used} + 1` },
        setWhere: sql`${schema.usageCounters.used} < ${account.limits.apiMonthly}`,
      })
      .returning();
    if (!used) throw new ProofError(429, "quota_exceeded", "Monthly API quota reached.");
    return { used: used.used, limit: account.limits.apiMonthly, period };
  });
}
export async function accountUsage(wallet: string) {
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Usage accounting unavailable.");
  return {
    ...(await accountEntitlements(wallet)),
    usage: await db
      .select()
      .from(schema.usageCounters)
      .where(and(eq(schema.usageCounters.wallet, wallet), eq(schema.usageCounters.period, new Date().toISOString().slice(0, 7)))),
  };
}

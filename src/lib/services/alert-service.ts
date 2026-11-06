import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import { log } from "../util/log";
import { randomUUID } from "node:crypto";

export type AlertState = { since: number | null; active: boolean; lastSent: number | null };
export type AlertPolicy = { sustainMs: number; cooldownMs: number; severity: "warning" | "critical" };
export type AlertEvent = { key: string; kind: "firing" | "recovered"; severity: AlertPolicy["severity"]; at: string };
export function transitionAlert(key: string, previous: AlertState | null, failing: boolean, now: number, policy: AlertPolicy) {
  const state: AlertState = { ...(previous ?? { since: null, active: false, lastSent: null }) };
  let event: AlertEvent | null = null;
  if (!failing) {
    if (state.active) event = { key, kind: "recovered", severity: policy.severity, at: new Date(now).toISOString() };
    state.since = null;
    state.active = false;
    if (event) state.lastSent = now;
  } else {
    state.since ??= now;
    if (now - state.since >= policy.sustainMs && (!state.active || state.lastSent === null || now - state.lastSent >= policy.cooldownMs)) {
      event = { key, kind: "firing", severity: policy.severity, at: new Date(now).toISOString() };
      state.active = true;
      state.lastSent = now;
    }
  }
  return { state, event };
}
export interface AlertAdapter {
  deliver(event: AlertEvent, id?: string): Promise<void>;
}
/** JSON logs are the default delivery adapter; deploy log drains for paging. */
export const logAlertAdapter: AlertAdapter = {
  async deliver(e) {
    log(e.kind === "recovered" ? "info" : "error", "operations.alert", e);
  },
};
const setting = (key: string, fallback: number) => {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${key}`);
  return n;
};
/** Serialize transitions in PostgreSQL so several schedulers cannot duplicate alerts. */
export async function evaluateAlert(key: string, failing: boolean | null, severity: AlertPolicy["severity"] = "warning") {
  if (failing === null) return; // Unknown cannot resolve an existing incident.
  const db = getDb();
  if (!db) throw new Error("Alert state database unavailable");
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.operationalAlerts)
      .values({ key, state: { since: null, active: false, lastSent: null } })
      .onConflictDoNothing();
    const [row] = await tx.select().from(schema.operationalAlerts).where(eq(schema.operationalAlerts.key, key)).for("update");
    const next = transitionAlert(key, row.state as AlertState, failing, Date.now(), {
      severity,
      sustainMs: setting("ALERT_SUSTAIN_S", 300) * 1000,
      cooldownMs: setting("ALERT_COOLDOWN_S", 3600) * 1000,
    });
    if (next.event) await tx.insert(schema.operationalAlertDeliveries).values({ id: randomUUID(), alertKey: key, payload: next.event });
    await tx.update(schema.operationalAlerts).set({ state: next.state, updatedAt: new Date() }).where(eq(schema.operationalAlerts.key, key));
  });
}

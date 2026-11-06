import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import { safeFetch } from "../proof/safe-fetch";
import { validatePublicUrl } from "../proof/url-guard";
import { webhookSignature } from "../developer/webhooks";
import { log } from "../util/log";
import type { AlertEvent, AlertAdapter } from "./alert-service";

/** Explicitly configured receiver; credentials never appear in the payload or error history. */
export function alertAdapter(transport = safeFetch): AlertAdapter {
  const endpoint = process.env.ALERT_WEBHOOK_URL;
  if (!endpoint)
    return {
      async deliver(event) {
        log(event.kind === "recovered" ? "info" : "error", "operations.alert", event);
      },
    };
  const checked = validatePublicUrl(endpoint),
    secret = process.env.ALERT_WEBHOOK_SECRET ?? "";
  if (!checked.ok || checked.url.search || checked.url.hash || secret.length < 32)
    throw new Error("Configure a public HTTPS alert endpoint and a 32+ character signing secret");
  return {
    async deliver(event, id = randomUUID()) {
      const body = JSON.stringify(event),
        timestamp = Math.floor(Date.now() / 1000);
      const response = await transport(endpoint, {
        method: "POST",
        body: Buffer.from(body),
        allowHttp: false,
        maxRedirects: 0,
        timeoutMs: 5000,
        maxBytes: 1024,
        headers: {
          "content-type": "application/json",
          "x-vibeproof-id": id,
          "x-vibeproof-timestamp": String(timestamp),
          "x-vibeproof-signature": `v1=${webhookSignature(secret, id, timestamp, body)}`,
        },
      });
      if (response.status < 200 || response.status >= 300 || response.redirects.length || response.truncated)
        throw new Error(`Alert delivery HTTP ${response.status}`);
    },
  };
}
/** At least once, with fencing and per-alert ordering even when several workers overlap. */
export async function deliverOperationalAlerts(limit = 2, adapter?: AlertAdapter) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Alert delivery limit must be 1–20");
  const db = getDb();
  if (!db) throw new Error("Alert queue database unavailable");
  const destination = adapter ?? alertAdapter();
  let delivered = 0,
    failed = 0,
    attempted = 0,
    exhausted = 0;
  for (let i = 0; i < limit; i++) {
    const lease = randomUUID();
    const [row] = await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string; payload: AlertEvent; attempts: number }>(sql`
        select d.id,d.payload,d.attempts from operational_alert_deliveries d
        where d.status in ('pending','processing') and d.next_attempt_at <= now()
          and not exists (select 1 from operational_alert_deliveries earlier where earlier.alert_key=d.alert_key and earlier.sequence<d.sequence and earlier.status in ('pending','processing'))
        order by d.sequence for update of d skip locked limit 1`);
      const claimed = [...rows][0];
      if (!claimed) return [];
      if (claimed.attempts >= 8) {
        await tx
          .update(schema.operationalAlertDeliveries)
          .set({ status: "dead", leaseToken: null, lastError: "Alert retry budget exhausted" })
          .where(eq(schema.operationalAlertDeliveries.id, claimed.id));
        return [{ ...claimed, exhausted: true }];
      }
      await tx
        .update(schema.operationalAlertDeliveries)
        .set({ status: "processing", leaseToken: lease, attempts: claimed.attempts + 1, nextAttemptAt: new Date(Date.now() + 60_000) })
        .where(eq(schema.operationalAlertDeliveries.id, claimed.id));
      return [claimed];
    });
    if (!row) break;
    if ("exhausted" in row) {
      exhausted++;
      continue;
    }
    attempted++;
    const owned = and(eq(schema.operationalAlertDeliveries.id, row.id), eq(schema.operationalAlertDeliveries.leaseToken, lease));
    try {
      await destination.deliver(row.payload, row.id);
      const acknowledged = await db
        .update(schema.operationalAlertDeliveries)
        .set({ status: "delivered", leaseToken: null, lastError: null })
        .where(owned)
        .returning({ id: schema.operationalAlertDeliveries.id });
      delivered += acknowledged.length;
    } catch (error) {
      failed++;
      const message = error instanceof Error && /^Alert delivery HTTP \d{3}$/.test(error.message) ? error.message : "Alert transport/configuration unavailable";
      await db
        .update(schema.operationalAlertDeliveries)
        .set({
          status: row.attempts + 1 >= 8 ? "dead" : "pending",
          leaseToken: null,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + Math.min(3600, 60 * 2 ** row.attempts) * 1000),
        })
        .where(owned);
      log("error", "operations.alert_delivery_failed", { id: row.id, attempt: row.attempts + 1, dead: row.attempts + 1 >= 8 });
    }
  }
  return { delivered, failed, attempted, exhausted };
}
/** With the database down there is no durable deduplication: receivers deduplicate this five-minute ID. */
export async function emergencyOperationalAlert() {
  const at = Math.floor(Date.now() / 300_000) * 300_000;
  const event: AlertEvent = { key: "operations_unavailable", kind: "firing", severity: "critical", at: new Date(at).toISOString() };
  log("error", "operations.alert", event);
  if (process.env.ALERT_WEBHOOK_URL) {
    try {
      await alertAdapter().deliver(event, createHash("sha256").update(`operations_unavailable:${at}`).digest("hex"));
    } catch {
      log("error", "operations.emergency_delivery_failed");
    }
  }
}

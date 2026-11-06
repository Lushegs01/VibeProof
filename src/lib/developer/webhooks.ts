import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "../db/client";
import { safeFetch } from "../proof/safe-fetch";
import { validatePublicUrl } from "../proof/url-guard";
import { ProofError } from "../services/proof-service";
import { accountEntitlements, lockAccount } from "../billing/entitlements";
import { SIGNIFICANT_KINDS } from "../services/watchlist-service";
function encryptionKey() {
  const key = process.env.WEBHOOK_ENCRYPTION_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new ProofError(503, "webhooks_unconfigured", "Configure WEBHOOK_ENCRYPTION_KEY (32 random bytes as hex).");
  return Buffer.from(key, "hex");
}
export function encryptWebhookSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  return Buffer.concat([iv, cipher.update(secret, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
export function decryptWebhookSecret(value: string) {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
}
export function webhookSignature(secret: string, id: string, timestamp: number, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${id}.${body}`).digest("hex");
}
/** Consumers also persist delivery IDs to suppress retries inside the timestamp window. */
export function validWebhookSignature(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(webhookSignature(secret, id, timestamp, body), "hex"), Buffer.from(signature, "hex"));
}
export async function createWebhook(wallet: string, endpoint: string, filters: string[]) {
  const checked = validatePublicUrl(endpoint);
  if (!checked.ok) throw new ProofError(400, "invalid_endpoint", checked.reason);
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Webhook database unavailable.");
  const id = crypto.randomUUID(),
    secret = randomBytes(32).toString("hex"),
    challenge = randomBytes(32).toString("hex");
  await db.transaction(async (tx) => {
    await lockAccount(tx as unknown as DB, wallet);
    const account = await accountEntitlements(wallet, tx as unknown as DB);
    const rows = await tx
      .select()
      .from(schema.webhookSubscriptions)
      .where(and(eq(schema.webhookSubscriptions.wallet, wallet), sql`status != 'disabled'`));
    if (rows.length >= account.limits.webhooks) throw new ProofError(409, "webhook_quota", "Webhook capacity reached for this plan.");
    await tx.insert(schema.webhookSubscriptions).values({ id, wallet, endpoint: checked.url.href, encryptedSecret: encryptWebhookSecret(secret), filters });
    await tx
      .insert(schema.webhookDeliveries)
      .values({ id: crypto.randomUUID(), subscriptionId: id, eventKey: `challenge:${id}`, payload: { type: "endpoint.challenge", challenge } });
  });
  return {
    id,
    secret,
    status: "pending",
    instructions:
      "Return the endpoint.challenge value as the exact plain-text HTTP 200 response. Only then will event delivery activate. The signing secret is shown once.",
  };
}
/** Durable source cursor + unique subscription/event constraint provide retry-safe fanout. */
export async function enqueueWebhookEvents(limit = 200) {
  const db = getDb();
  if (!db) return 0;
  return db.transaction(async (tx) => {
    await tx.insert(schema.indexerState).values({ key: "webhook:feed", lastBlock: 0n }).onConflictDoNothing();
    const [cursor] = await tx.select().from(schema.indexerState).where(eq(schema.indexerState.key, "webhook:feed")).for("update");
    const events = await tx
      .select()
      .from(schema.feedEvents)
      .where(sql`id > ${cursor.lastBlock}`)
      .orderBy(schema.feedEvents.id)
      .limit(limit);
    let count = 0;
    for (const event of events) {
      if (!(SIGNIFICANT_KINDS as readonly string[]).includes(event.kind)) continue;
      const subscriptions = await tx.execute<{ id: string; filters: string[] }>(
        sql`select s.id,s.filters from webhook_subscriptions s join wallet_watchlist w on w.wallet=s.wallet where s.status='active' and w.chain_id=${event.chainId} and w.token_address=${event.tokenAddress} and s.created_at <= ${event.createdAt.toISOString()} and w.created_at <= ${event.createdAt.toISOString()}`,
      );
      for (const sub of subscriptions) {
        if (!sub.filters.includes(event.kind)) continue;
        await tx
          .insert(schema.webhookDeliveries)
          .values({
            id: crypto.randomUUID(),
            subscriptionId: sub.id,
            eventKey: `feed:${event.id}`,
            payload: {
              schema: "vibeproof.event.v1",
              eventId: event.id,
              kind: event.kind,
              chainId: event.chainId,
              token: event.tokenAddress,
              observedAt: event.createdAt.toISOString(),
              txHash: event.txHash,
              block: event.blockNumber?.toString() ?? null,
              evidence: event.data,
              message: event.message,
            },
          })
          .onConflictDoNothing();
        count++;
      }
    }
    if (events.length)
      await tx
        .update(schema.indexerState)
        .set({ lastBlock: BigInt(events.at(-1)!.id), updatedAt: new Date() })
        .where(eq(schema.indexerState.key, "webhook:feed"));
    return count;
  });
}
export const webhookRetrySeconds = (attempt: number) => Math.min(86400, 30 * 2 ** Math.max(0, attempt - 1));
export async function deliverWebhooks(limit = 20, fetcher = safeFetch) {
  const db = getDb();
  if (!db) return { delivered: 0, failed: 0 };
  let delivered = 0,
    failed = 0;
  for (let i = 0; i < limit; i++) {
    const rows = await db.execute<{ id: string; subscription_id: string; payload: Record<string, unknown>; attempts: number }>(
      sql`update webhook_deliveries set status='delivering',attempts=attempts+1,next_attempt_at=now()+interval '60 seconds' where id=(select id from webhook_deliveries where status in ('pending','retry','delivering') and next_attempt_at<=now() order by next_attempt_at,id for update skip locked limit 1) returning *`,
    );
    const row = rows[0];
    if (!row) break;
    const [sub] = await db.select().from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, row.subscription_id));
    try {
      if (!sub || sub.status === "disabled") {
        await db.update(schema.webhookDeliveries).set({ status: "disabled" }).where(eq(schema.webhookDeliveries.id, row.id));
        continue;
      }
      const challenge = row.payload.type === "endpoint.challenge";
      if (!challenge && sub.status !== "active") throw new Error("Endpoint ownership not verified");
      const timestamp = Math.floor(Date.now() / 1000),
        body = JSON.stringify(row.payload);
      const signature = webhookSignature(decryptWebhookSecret(sub.encryptedSecret), row.id, timestamp, body);
      const response = await fetcher(sub.endpoint, {
        method: "POST",
        body: Buffer.from(body),
        headers: {
          "content-type": "application/json",
          "x-vibeproof-id": row.id,
          "x-vibeproof-timestamp": String(timestamp),
          "x-vibeproof-signature": `v1=${signature}`,
        },
        maxBytes: 1024,
        maxRedirects: 0,
        timeoutMs: 8000,
        allowHttp: false,
      });
      if (response.status < 200 || response.status >= 300 || response.truncated || (challenge && response.body.trim() !== row.payload.challenge))
        throw new Error(`Endpoint refused delivery or challenge (HTTP ${response.status})`);
      await db.transaction(async (tx) => {
        await tx.update(schema.webhookDeliveries).set({ status: "delivered", lastError: null }).where(eq(schema.webhookDeliveries.id, row.id));
        if (challenge)
          await tx
            .update(schema.webhookSubscriptions)
            .set({ status: "active" })
            .where(and(eq(schema.webhookSubscriptions.id, sub.id), eq(schema.webhookSubscriptions.status, "pending")));
      });
      delivered++;
    } catch {
      // Never retain or log response bodies or signing credentials.
      await db
        .update(schema.webhookDeliveries)
        .set({
          status: row.attempts >= 8 ? "dead" : "retry",
          lastError: "Delivery unavailable, blocked, or endpoint validation failed",
          nextAttemptAt: new Date(Date.now() + webhookRetrySeconds(row.attempts) * 1000),
        })
        .where(eq(schema.webhookDeliveries.id, row.id));
      failed++;
    }
  }
  return { delivered, failed };
}

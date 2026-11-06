import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { route, ok, fail } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { sessionWallet } from "@/lib/auth/request";
import { createWebhook } from "@/lib/developer/webhooks";
import { getDb, schema } from "@/lib/db/client";
import { ProofError } from "@/lib/services/proof-service";
import { SIGNIFICANT_KINDS } from "@/lib/services/watchlist-service";
export const GET = route("webhook_list", {}, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in first.");
  const db = getDb();
  if (!db) return fail(503, "db_unavailable", "Database unavailable.");
  const subscriptions = await db
    .select({
      id: schema.webhookSubscriptions.id,
      endpoint: schema.webhookSubscriptions.endpoint,
      status: schema.webhookSubscriptions.status,
      filters: schema.webhookSubscriptions.filters,
    })
    .from(schema.webhookSubscriptions)
    .where(eq(schema.webhookSubscriptions.wallet, wallet.toLowerCase()));
  const deliveries = subscriptions.length
    ? await db
        .select({
          id: schema.webhookDeliveries.id,
          subscriptionId: schema.webhookDeliveries.subscriptionId,
          status: schema.webhookDeliveries.status,
          attempts: schema.webhookDeliveries.attempts,
          nextAttemptAt: schema.webhookDeliveries.nextAttemptAt,
          lastError: schema.webhookDeliveries.lastError,
        })
        .from(schema.webhookDeliveries)
        .where(
          inArray(
            schema.webhookDeliveries.subscriptionId,
            subscriptions.map((s) => s.id),
          ),
        )
        .orderBy(desc(schema.webhookDeliveries.createdAt))
        .limit(100)
    : [];
  return ok({ subscriptions, deliveries }, baseMeta("Webhook subscriptions and delivery log"));
});
export const POST = route("webhook_create", { limit: 5 }, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in first.");
  const input = z
    .object({ endpoint: z.string().url().max(500), filters: z.array(z.enum(SIGNIFICANT_KINDS)).min(1).max(20) })
    .safeParse(await req.json().catch(() => null));
  if (!input.success) return fail(400, "invalid_body", "Provide endpoint and significant event filters.");
  try {
    return ok(await createWebhook(wallet.toLowerCase(), input.data.endpoint, input.data.filters), baseMeta("Pending endpoint ownership challenge"));
  } catch (e) {
    if (e instanceof ProofError) return fail(e.status, e.code, e.message);
    throw e;
  }
});
export const DELETE = route("webhook_disable", { limit: 10 }, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in first.");
  const input = z.object({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!input.success) return fail(400, "invalid_id", "Expected subscription id.");
  const db = getDb();
  if (!db) return fail(503, "db_unavailable", "Database unavailable.");
  await db
    .update(schema.webhookSubscriptions)
    .set({ status: "disabled" })
    .where(and(eq(schema.webhookSubscriptions.id, input.data.id), eq(schema.webhookSubscriptions.wallet, wallet.toLowerCase())));
  return ok({ disabled: true }, baseMeta("Webhook endpoint disabled"));
});

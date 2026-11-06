import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { keccak256, toBytes, type Address } from "viem";
import { getDb, getSql, schema } from "@/lib/db/client";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { updateWatched, listWatched, watchNotifications } from "@/lib/services/watchlist-service";
import { accountEntitlements, consumeApiUsage } from "@/lib/billing/entitlements";
import { createDeveloperKey, developerWallet } from "@/lib/developer/keys";
import { createWebhook, deliverWebhooks, enqueueWebhookEvents } from "@/lib/developer/webhooks";
import { issueControlChallenge, verifyControlChallenge } from "@/lib/proof/challenges";
import { DatabaseEvidenceStore } from "@/lib/proof/storage";
import { canonicalProofMetadata } from "@/lib/proof/metadata";
import { createSessionToken, sessionCookie } from "@/lib/auth/session";
import { revokeSession, sessionWallet } from "@/lib/auth/request";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@127.0.0.1:5432/vibeproof_test";
process.env.REDIS_URL = "";
const wallet = `0x${"d".repeat(40)}` as Address,
  token = `0x${"e".repeat(40)}` as Address;
const db = getDb()!;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  process.env.WEBHOOK_ENCRYPTION_KEY = "f".repeat(64);
  process.env.NEXT_PUBLIC_APP_URL = "https://vibeproof.example";
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await getSql()?.end();
});
const fetched = (body: string, status = 200) => ({
  body,
  bytes: Buffer.from(body),
  status,
  headers: {},
  finalUrl: "https://receiver.example/hook",
  redirects: [],
  truncated: false,
  tls: { valid: true },
  ms: 1,
});
describe.runIf(process.env.SKIP_DB_TESTS !== "1")("integrated production foundations", () => {
  it("applies additive migrations twice and preserves existing indexed records", async () => {
    await db.insert(schema.tokens).values({ chainId: 46630, address: token, name: "preserved" }).onConflictDoNothing();
    await migrate(db, { migrationsFolder: "./drizzle" });
    await migrate(db, { migrationsFolder: "./drizzle" });
    expect((await db.select().from(schema.tokens).where(eq(schema.tokens.address, token)))[0].name).toBe("preserved");
  });
  it("enforces watchlist quotas under concurrent writes and isolates networks", async () => {
    await db.delete(schema.walletWatchlist).where(eq(schema.walletWatchlist.wallet, wallet));
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) => updateWatched(wallet, 46630, `0x${i.toString(16).padStart(40, "0")}`, "add")),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(20);
    expect(await listWatched(wallet)).toHaveLength(20);
    await db.delete(schema.walletWatchlist).where(eq(schema.walletWatchlist.wallet, wallet));
    await updateWatched(wallet, 46630, token, "add");
    await updateWatched(wallet, 46630, token, "add");
    await updateWatched(wallet, 4663, token, "add");
    expect(await listWatched(wallet)).toHaveLength(2);
  });
  it("accounts API usage atomically and revokes developer credentials", async () => {
    await db.delete(schema.usageCounters).where(eq(schema.usageCounters.wallet, wallet));
    const account = await accountEntitlements(wallet);
    expect(account.plan).toBe("free");
    await db.insert(schema.usageCounters).values({ wallet, metric: "api", period: new Date().toISOString().slice(0, 7), used: 999 });
    const raced = await Promise.allSettled([consumeApiUsage(wallet), consumeApiUsage(wallet)]);
    expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(raced.filter((r) => r.status === "rejected")).toHaveLength(1);
    const credential = await createDeveloperKey(wallet, "integration");
    const req = new Request("https://vibeproof.example", { headers: { authorization: `Bearer ${credential.key}` } });
    expect(await developerWallet(req)).toBe(wallet);
    await db.update(schema.developerKeys).set({ revokedAt: new Date() }).where(eq(schema.developerKeys.wallet, wallet));
    expect(await developerWallet(req)).toBeNull();
  });
  it("retains exact immutable bytes and historical documents on proof updates", async () => {
    const store = new DatabaseEvidenceStore();
    const bytes = toBytes(canonicalProofMetadata({ chainId: 46630, creator: wallet, token, description: "original" }));
    const original = await store.put(bytes);
    await store.put(toBytes(canonicalProofMetadata({ chainId: 46630, creator: wallet, token, description: "updated" })));
    const [row] = await db.select().from(schema.proofDocuments).where(eq(schema.proofDocuments.hash, original.hash));
    expect(keccak256(toBytes(row.canonical))).toBe(original.hash);
    expect(row.canonical).toBe(Buffer.from(bytes).toString());
  });
  it("binds challenges to the authenticated creator, consumes once, expires, and revokes sessions", async () => {
    await db
      .insert(schema.launches)
      .values({
        chainId: 46630,
        tokenAddress: token,
        creatorAddress: wallet,
        factoryAddress: token,
        deploymentId: "test",
        txHash: `0x${"a".repeat(64)}`,
        blockNumber: 1n,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    await expect(issueControlChallenge(token, token, "website", "https://project.example")).rejects.toMatchObject({ status: 403 });
    const challenge = await issueControlChallenge(wallet, token, "website", "https://project.example");
    await expect(verifyControlChallenge(wallet, challenge.id, async () => fetched("wrong"))).rejects.toMatchObject({ code: "challenge_mismatch" });
    expect((await verifyControlChallenge(wallet, challenge.id, async () => fetched(challenge.challenge))).status).toBe("control_verified");
    await expect(verifyControlChallenge(wallet, challenge.id, async () => fetched(challenge.challenge))).rejects.toMatchObject({ code: "challenge_expired" });
    const expired = await issueControlChallenge(wallet, token, "website", "https://project.example");
    await db
      .update(schema.ownershipChallenges)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.ownershipChallenges.id, expired.id));
    await expect(verifyControlChallenge(wallet, expired.id)).rejects.toMatchObject({ code: "challenge_expired" });
    const session = createSessionToken(wallet);
    const req = new Request("https://vibeproof.example", { headers: { cookie: sessionCookie(session).split(";")[0] } });
    expect(await sessionWallet(req)).not.toBeNull();
    await revokeSession(req);
    expect(await sessionWallet(req)).toBeNull();
  });
  it("requires endpoint ownership and delivers filtered significant changes with idempotent retries", async () => {
    await db
      .insert(schema.accountPlans)
      .values({ wallet, plan: "developer", subscriptionState: "active" })
      .onConflictDoUpdate({ target: schema.accountPlans.wallet, set: { plan: "developer", subscriptionState: "active" } });
    await expect(createWebhook(wallet, "https://127.0.0.1/hook", ["proof"])).rejects.toMatchObject({ code: "invalid_endpoint" });
    const sub = await createWebhook(wallet, "https://receiver.example/hook", ["proof"]);
    const attempts: { id: string; signature: string }[] = [];
    const fetcher: typeof import("@/lib/proof/safe-fetch").safeFetch = async (_url, opts) => {
      const body = JSON.parse(opts!.body!.toString());
      attempts.push({ id: opts!.headers!["x-vibeproof-id"], signature: opts!.headers!["x-vibeproof-signature"] });
      return fetched(body.challenge ?? "ok");
    };
    expect((await deliverWebhooks(1, fetcher)).delivered).toBe(1);
    expect((await db.select().from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, sub.id)))[0].status).toBe("active");
    // Guarantee source times are later than subscriptions/watchlist creation.
    await db.insert(schema.feedEvents).values({
      chainId: 46630,
      tokenAddress: token,
      kind: "proof",
      message: "New evidence claim",
      createdAt: new Date(Date.now() + 1000),
      data: { source: "test", assurance: "creator_claimed" },
    });
    await enqueueWebhookEvents();
    await enqueueWebhookEvents();
    const pending = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(and(eq(schema.webhookDeliveries.subscriptionId, sub.id), eq(schema.webhookDeliveries.status, "pending")));
    expect(pending).toHaveLength(1);
    const bad: typeof fetcher = async () => fetched("unavailable", 503);
    expect((await deliverWebhooks(1, bad)).failed).toBe(1);
    await db
      .update(schema.webhookDeliveries)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(schema.webhookDeliveries.id, pending[0].id));
    expect((await deliverWebhooks(1, fetcher)).delivered).toBe(1);
    expect(attempts.at(-1)!.id).toBe(pending[0].id);
    expect((await watchNotifications(wallet)).some((n) => n.kind === "proof")).toBe(true);
    await db.update(schema.webhookSubscriptions).set({ status: "disabled" }).where(eq(schema.webhookSubscriptions.id, sub.id));
  });
});

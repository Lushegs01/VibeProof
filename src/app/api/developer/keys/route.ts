import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { route, ok, fail } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { sessionWallet } from "@/lib/auth/request";
import { createDeveloperKey } from "@/lib/developer/keys";
import { getDb, schema } from "@/lib/db/client";
import { ProofError } from "@/lib/services/proof-service";
export const GET = route("developer_keys_list", {}, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in first.");
  const db = getDb();
  if (!db) return fail(503, "db_unavailable", "Credential storage unavailable.");
  return ok(
    await db
      .select({ id: schema.developerKeys.hash, label: schema.developerKeys.label, createdAt: schema.developerKeys.createdAt })
      .from(schema.developerKeys)
      .where(and(eq(schema.developerKeys.wallet, wallet.toLowerCase()), isNull(schema.developerKeys.revokedAt))),
    baseMeta("Active developer credentials (hash identifiers only)"),
  );
});
export const POST = route("developer_keys_create", { limit: 5 }, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in first.");
  const input = z.object({ label: z.string().trim().min(1).max(80) }).safeParse(await req.json().catch(() => null));
  if (!input.success) return fail(400, "invalid_label", "Provide a credential label.");
  try {
    return ok(await createDeveloperKey(wallet.toLowerCase(), input.data.label), baseMeta("Cryptographically random API credential"));
  } catch (e) {
    if (e instanceof ProofError) return fail(e.status, e.code, e.message);
    throw e;
  }
});
export const DELETE = route("developer_keys_revoke", { limit: 10 }, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in first.");
  const input = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await req.json().catch(() => null));
  if (!input.success) return fail(400, "invalid_id", "Expected credential hash identifier.");
  const db = getDb();
  if (!db) return fail(503, "db_unavailable", "Credential storage unavailable.");
  await db
    .update(schema.developerKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.developerKeys.hash, input.data.id), eq(schema.developerKeys.wallet, wallet.toLowerCase())));
  return ok({ revoked: true }, baseMeta("Credential revocation"));
});

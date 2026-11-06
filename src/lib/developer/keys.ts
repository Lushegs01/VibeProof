import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import { ProofError } from "../services/proof-service";
export const keyDigest = (key: string) => createHash("sha256").update(key).digest("hex");
export async function createDeveloperKey(wallet: string, label: string) {
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Credential storage unavailable.");
  const key = `vp_${randomBytes(32).toString("base64url")}`;
  await db.transaction(async (tx) => {
    await tx.execute((await import("drizzle-orm")).sql`select pg_advisory_xact_lock(hashtext(${wallet}))`);
    const keys = await tx
      .select()
      .from(schema.developerKeys)
      .where(and(eq(schema.developerKeys.wallet, wallet), isNull(schema.developerKeys.revokedAt)));
    if (keys.length >= 5) throw new ProofError(409, "key_limit", "Revoke an existing credential before creating another.");
    await tx.insert(schema.developerKeys).values({ hash: keyDigest(key), wallet, label });
  });
  return { key, message: "Shown once. Store securely. Only its hash is retained by VibeProof." };
}
export async function developerWallet(req: Request) {
  const key = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!key || !/^vp_[A-Za-z0-9_-]{43}$/.test(key)) return null;
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Credential storage unavailable.");
  const [row] = await db
    .select()
    .from(schema.developerKeys)
    .where(and(eq(schema.developerKeys.hash, keyDigest(key)), isNull(schema.developerKeys.revokedAt)));
  return row?.wallet ?? null;
}

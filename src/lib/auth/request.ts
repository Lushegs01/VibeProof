import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import { readCookie, readSessionToken, SESSION_COOKIE } from "./session";

export function applicationOrigin(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured && process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_APP_URL required in production");
  return new URL(configured || req.url).origin;
}
export function sameOriginRequest(req: Request) {
  const origin = req.headers.get("origin");
  return !!origin && origin === applicationOrigin(req) && req.headers.get("sec-fetch-site") !== "cross-site";
}
export async function sessionWallet(req: Request) {
  const token = readCookie(req, SESSION_COOKIE);
  const wallet = readSessionToken(token);
  if (!wallet || !token) return null;
  const db = getDb();
  if (!db) {
    if (process.env.NODE_ENV === "production") throw new Error("Session revocation database unavailable");
    return wallet;
  }
  const [revoked] = await db
    .select()
    .from(schema.revokedSessions)
    .where(eq(schema.revokedSessions.hash, createHash("sha256").update(token).digest("hex")));
  return revoked ? null : wallet;
}
export async function revokeSession(req: Request) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || !readSessionToken(token)) return;
  const db = getDb();
  if (!db) throw new Error("Session revocation database unavailable");
  await db
    .insert(schema.revokedSessions)
    .values({ hash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000) })
    .onConflictDoNothing();
}

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import { activeNetwork } from "../chain/networks";
import { getDb, schema } from "../db/client";

export const SESSION_COOKIE = "vp_session";
const SESSION_TTL_S = 24 * 3600;
const NONCE_TTL_MS = 10 * 60_000;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (32+ chars) in production");
    return "dev-only-insecure-session-secret-change-me-please!!";
  }
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

/** Session token: base64url(address|exp).sig — stateless, HMAC-SHA256. Contains no signature material from the wallet. */
export function createSessionToken(address: Address, now = Date.now()) {
  const payload = Buffer.from(
    `${address.toLowerCase()}|${Math.floor(now / 1000) + SESSION_TTL_S}|${activeNetwork().chainId}|${randomBytes(16).toString("hex")}`,
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined | null, now = Date.now()): Address | null {
  if (!token || token.length > 512 || token.split(".").length !== 2) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  const [addr, exp, chain, id] = Buffer.from(payload, "base64url").toString().split("|");
  if (!addr || !exp || !Number.isSafeInteger(Number(exp)) || Number(exp) * 1000 <= now || Number(chain) !== activeNetwork().chainId || !id) return null;
  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

export function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_S}${secure}`;
}

export function readCookie(req: Request, name: string) {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// ── Nonces (single use, 10 min) ───────────────────────────────────────────────
const memNonces = new Map<string, number>();

export async function issueNonce(): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const db = getDb();
  if (db) await db.insert(schema.authNonces).values({ nonce });
  else {
    if (process.env.NODE_ENV === "production") throw new Error("Shared nonce database required in production");
    for (const [key, at] of memNonces) if (Date.now() - at > NONCE_TTL_MS) memNonces.delete(key);
    if (memNonces.size >= 10000) throw new Error("Nonce capacity reached");
    memNonces.set(nonce, Date.now());
  }
  return nonce;
}

/** Atomically consume a nonce. Returns false if unknown, used, or expired. */
export async function consumeNonce(nonce: string): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(nonce)) return false;
  const db = getDb();
  if (!db) {
    const t = memNonces.get(nonce);
    memNonces.delete(nonce);
    return !!t && Date.now() - t < NONCE_TTL_MS;
  }
  // Single conditional UPDATE: succeeds only for an unused, unexpired nonce (race-safe).
  const rows = await db
    .update(schema.authNonces)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.authNonces.nonce, nonce), isNull(schema.authNonces.usedAt), gt(schema.authNonces.createdAt, new Date(Date.now() - NONCE_TTL_MS))))
    .returning({ nonce: schema.authNonces.nonce });
  return rows.length === 1;
}

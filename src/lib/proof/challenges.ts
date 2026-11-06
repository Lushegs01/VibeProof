import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { getAddress, keccak256, toBytes, type Address } from "viem";
import { getDb, schema } from "../db/client";
import { authorizeSubmitter, ProofError } from "../services/proof-service";
import { invalidatePassport } from "../services/token-service";
import { parseGithubRepo, validatePublicUrl } from "./url-guard";
import { safeFetch } from "./safe-fetch";
export type ControlKind = "website" | "github";
export function controlTarget(kind: ControlKind, target: string) {
  if (kind === "github") {
    const repo = parseGithubRepo(target);
    if (!repo) throw new ProofError(400, "invalid_repository", "Expected a public GitHub repository URL.");
    return `https://github.com/${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`;
  }
  const result = validatePublicUrl(target);
  if (!result.ok) throw new ProofError(400, "invalid_domain", result.reason);
  return result.url.origin;
}
export function challengeMatches(content: string, expectedHash: string) {
  return content.length <= 1024 && keccak256(toBytes(content.trim())) === expectedHash;
}
export function controlState(row: { status: string; validUntil: Date | null }, now = new Date()) {
  return row.status === "verified"
    ? row.validUntil && row.validUntil > now
      ? "control_verified"
      : "expired"
    : row.status === "revoked"
      ? "historical_verification"
      : row.status;
}
export async function issueControlChallenge(wallet: Address, token: Address, kind: ControlKind, input: string) {
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Challenge database unavailable.");
  if (!(await authorizeSubmitter(token, wallet)))
    throw new ProofError(403, "not_creator", "Only the current authorized creator can request control verification.");
  const target = controlTarget(kind, input);
  const id = randomUUID();
  const challenge = `vibeproof-control-v1:${id}:${randomBytes(32).toString("hex")}`;
  const chainId = (await import("../chain/networks")).activeNetwork().chainId;
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  await db.transaction(async (tx) => {
    // Reissuing invalidates pending challenges, while historical successes remain auditable.
    await tx
      .update(schema.ownershipChallenges)
      .set({ status: "revoked" })
      .where(
        and(
          eq(schema.ownershipChallenges.chainId, chainId),
          eq(schema.ownershipChallenges.tokenAddress, token.toLowerCase()),
          eq(schema.ownershipChallenges.creatorAddress, wallet.toLowerCase()),
          eq(schema.ownershipChallenges.kind, kind),
          eq(schema.ownershipChallenges.target, target),
          eq(schema.ownershipChallenges.status, "pending"),
        ),
      );
    await tx.insert(schema.ownershipChallenges).values({
      id,
      chainId,
      tokenAddress: token.toLowerCase(),
      creatorAddress: wallet.toLowerCase(),
      kind,
      target,
      secretHash: keccak256(toBytes(challenge)),
      expiresAt,
    });
  });
  return {
    id,
    challenge,
    target,
    expiresAt: expiresAt.toISOString(),
    path: kind === "website" ? `/.well-known/vibeproof/${id}.txt` : `.well-known/vibeproof/${id}.txt`,
    instructions:
      "Publish the exact challenge as plain text. Completing it proves control at the time checked, not project legitimacy. Verification expires after seven days.",
  };
}
export async function verifyControlChallenge(wallet: Address, id: string, fetcher = safeFetch) {
  const db = getDb();
  if (!db) throw new ProofError(503, "db_unavailable", "Challenge database unavailable.");
  const chainId = (await import("../chain/networks")).activeNetwork().chainId;
  const [row] = await db
    .select()
    .from(schema.ownershipChallenges)
    .where(
      and(
        eq(schema.ownershipChallenges.id, id),
        eq(schema.ownershipChallenges.chainId, chainId),
        eq(schema.ownershipChallenges.creatorAddress, wallet.toLowerCase()),
      ),
    );
  if (!row || row.status !== "pending" || row.expiresAt <= new Date())
    throw new ProofError(409, "challenge_expired", "Challenge is missing, expired, revoked, or already consumed.");
  if (!(await authorizeSubmitter(getAddress(row.tokenAddress), wallet))) throw new ProofError(403, "not_creator", "Creator authorization has changed.");
  let url: string;
  if (row.kind === "github") {
    const repo = parseGithubRepo(row.target)!;
    const r = await fetcher(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, { maxBytes: 32768, maxRedirects: 0, allowHttp: false });
    if (r.status !== 200 || r.truncated)
      throw new ProofError(409, "repository_unavailable", "Repository is unavailable, renamed, or transferred. Request a new challenge.");
    const data = JSON.parse(r.body) as { archived?: boolean; full_name?: string };
    if (data.archived || data.full_name?.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase())
      throw new ProofError(409, "repository_changed", "Archived, transferred or renamed repositories need a new challenge.");
    url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/.well-known/vibeproof/${id}.txt`;
  } else url = `${row.target}/.well-known/vibeproof/${id}.txt`;
  const response = await fetcher(url, { maxBytes: 1024, maxRedirects: 0, allowHttp: false });
  if (response.status !== 200 || response.truncated || !challengeMatches(response.body, row.secretHash))
    throw new ProofError(422, "challenge_mismatch", "Published challenge does not match. Check the exact path and text.");
  const now = new Date();
  const validUntil = new Date(now.getTime() + 7 * 86400_000);
  const updated = await db
    .update(schema.ownershipChallenges)
    .set({ status: "verified", verifiedAt: now, lastCheckedAt: now, validUntil })
    .where(and(eq(schema.ownershipChallenges.id, id), eq(schema.ownershipChallenges.status, "pending"), gt(schema.ownershipChallenges.expiresAt, now)))
    .returning();
  if (updated.length !== 1) throw new ProofError(409, "challenge_replayed", "Challenge was already consumed or expired.");
  await db.insert(schema.feedEvents).values({
    chainId,
    tokenAddress: row.tokenAddress,
    kind: "control_verified",
    message: `${row.kind} control verified until ${validUntil.toISOString()}`,
    data: { target: row.target, source: url, verifiedAt: now.toISOString(), validUntil: validUntil.toISOString(), limitation: "Control is not legitimacy" },
  });
  await invalidatePassport(row.tokenAddress);
  return { status: "control_verified", target: row.target, verifiedAt: now.toISOString(), validUntil: validUntil.toISOString(), source: url };
}
/** Periodic bounded revalidation: lost control is immediately reflected; expiry never extends silently. */
export async function recheckControls(limit = 5) {
  const db = getDb();
  if (!db) return 0;
  const rows = await db
    .select()
    .from(schema.ownershipChallenges)
    .where(and(sql`${schema.ownershipChallenges.status} in ('verified','unavailable')`, sql`last_checked_at < now() - interval '24 hours'`))
    .limit(limit);
  let checked = 0;
  for (const row of rows) {
    if (!row.validUntil || row.validUntil <= new Date()) {
      await db.update(schema.ownershipChallenges).set({ status: "expired" }).where(eq(schema.ownershipChallenges.id, row.id));
      await db.insert(schema.feedEvents).values({
        chainId: row.chainId,
        tokenAddress: row.tokenAddress,
        kind: "control_expired",
        message: `${row.kind} control verification expired`,
        data: { target: row.target, validUntil: row.validUntil?.toISOString() },
      });
      await invalidatePassport(row.tokenAddress);
      continue;
    }
    // Verification reuses the original published challenge, never issues or consumes a new one.
    const repo = row.kind === "github" ? parseGithubRepo(row.target) : null;
    const url = repo
      ? `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/.well-known/vibeproof/${row.id}.txt`
      : `${row.target}/.well-known/vibeproof/${row.id}.txt`;
    let status = "verified";
    try {
      const r = await safeFetch(url, { maxBytes: 1024, maxRedirects: 0, allowHttp: false });
      if (r.status !== 200 || r.truncated || !challengeMatches(r.body, row.secretHash)) status = "revoked";
    } catch {
      status = "unavailable";
    }
    await db.update(schema.ownershipChallenges).set({ status, lastCheckedAt: new Date() }).where(eq(schema.ownershipChallenges.id, row.id));
    if (status === "revoked")
      await db.insert(schema.feedEvents).values({
        chainId: row.chainId,
        tokenAddress: row.tokenAddress,
        kind: "control_revoked",
        message: `${row.kind} control challenge is no longer present`,
        data: { target: row.target, source: url },
      });
    await invalidatePassport(row.tokenAddress);
    checked++;
  }
  return checked;
}

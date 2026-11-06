import { and, eq, sql } from "drizzle-orm";
import { getAddress } from "viem";
import type { DB } from "../lib/db/client";
import { schema } from "../lib/db/client";
import { extractClaims, fetchMetadata, type MetadataResult } from "../lib/metadata/ingest";
import { checkGithub, checkWebsite, type UrlCheckResult } from "../lib/proof/checks";
import { parseGithubRepo } from "../lib/proof/url-guard";
import { log } from "../lib/util/log";

const { tokenMetadata, verificationChecks } = schema;

export type MetadataWorkerOptions = {
  /** Metadata documents fetched per tick. */
  perTick?: number;
  concurrency?: number;
  maxAttempts?: number;
  /** Website/GitHub checks of links claimed in metadata, per tick (0 disables). */
  enrichPerTick?: number;
  fetch?: typeof fetchMetadata;
  website?: typeof checkWebsite;
  github?: typeof checkGithub;
  shouldStop?: () => boolean;
  onResult?: (status: MetadataResult["status"]) => void;
};

const num = (k: string) => (process.env[k] ? Number(process.env[k]) : undefined);

/**
 * Fetch pending launch metadata (bounded per tick; network failures retried with backoff).
 * Then, for a few documents per tick, probe the website a creator CLAIMED in the metadata.
 * The probe can establish reachability or that the site references this contract
 * (observed/verified). The claim itself stays a creator claim.
 */
export async function processMetadataQueue(db: DB, chainId: number, opts: MetadataWorkerOptions = {}): Promise<number> {
  const perTick = opts.perTick ?? num("METADATA_FETCH_PER_TICK") ?? 20;
  if (perTick <= 0) return 0;
  const maxAttempts = opts.maxAttempts ?? 6;
  const rows = await db
    .select()
    .from(tokenMetadata)
    .where(
      and(
        eq(tokenMetadata.chainId, chainId),
        sql`(${tokenMetadata.status} = 'pending' or (${tokenMetadata.status} in ('unavailable', 'integrity_mismatch') and ${tokenMetadata.attempts} < ${maxAttempts}))`,
        sql`(${tokenMetadata.nextAttemptAt} is null or ${tokenMetadata.nextAttemptAt} <= now())`,
      ),
    )
    .orderBy(sql`${tokenMetadata.priority} desc, ${tokenMetadata.createdAt} desc`)
    .limit(perTick);
  const fetcher = opts.fetch ?? fetchMetadata;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  let n = 0;
  for (let i = 0; i < rows.length; i += concurrency) {
    if (opts.shouldStop?.()) break;
    await Promise.all(
      rows.slice(i, i + concurrency).map(async (r) => {
        let res: MetadataResult;
        try {
          res = await fetcher(r.uri, { onchainDigest: r.onchainDigest as `0x${string}` | null });
        } catch (e) {
          res = { status: "unavailable", retryable: true, error: e instanceof Error ? e.message.slice(0, 200) : String(e) } as MetadataResult;
        }
        const attempts = r.attempts + 1;
        const retry = res.retryable && attempts < maxAttempts;
        await db
          .update(tokenMetadata)
          .set({
            status: res.status,
            normalizedUrl: res.normalizedUrl ?? null,
            gateway: res.gateway ?? null,
            httpStatus: res.httpStatus ?? null,
            contentType: res.contentType?.slice(0, 200) ?? null,
            bytes: res.bytes ?? null,
            keccak256: res.keccak256 ?? null,
            sha256: res.sha256 ?? null,
            cidVerified: res.cidVerified ?? null,
            digestMatch: res.digestMatch ?? null,
            data: (res.data ?? null) as never,
            error: res.error?.slice(0, 500) ?? null,
            attempts,
            nextAttemptAt: retry ? new Date(Date.now() + Math.min(24 * 3600, 60 * 4 ** (attempts - 1)) * 1000) : null,
            fetchedAt: res.status === "ok" ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(and(eq(tokenMetadata.chainId, chainId), eq(tokenMetadata.tokenAddress, r.tokenAddress)));
        n++;
        opts.onResult?.(res.status);
        log(res.status === "ok" ? "debug" : "info", "indexer.metadata_fetch", {
          chainId,
          token: r.tokenAddress,
          status: res.status,
          gateway: res.gateway ?? null,
          cidVerified: res.cidVerified ?? null,
          digestMatch: res.digestMatch ?? null,
          error: res.error ?? null,
          retry,
        });
      }),
    );
  }
  const enrich = opts.enrichPerTick ?? num("METADATA_ENRICH_PER_TICK") ?? 2;
  if (enrich > 0 && !opts.shouldStop?.())
    await enrichClaimedLinks(db, chainId, enrich, opts).catch((e) =>
      log("warn", "indexer.metadata_enrich_failed", { error: e instanceof Error ? e.message : String(e) }),
    );
  return n;
}

/** Probe websites (and GitHub repos) claimed in fetched metadata. Each token is enriched once. */
export async function enrichClaimedLinks(db: DB, chainId: number, limit: number, opts: Pick<MetadataWorkerOptions, "website" | "github"> = {}) {
  const rows = await db
    .select({ token: tokenMetadata.tokenAddress, data: tokenMetadata.data })
    .from(tokenMetadata)
    .where(and(eq(tokenMetadata.chainId, chainId), eq(tokenMetadata.status, "ok"), sql`${tokenMetadata.enrichedAt} is null`))
    .orderBy(sql`${tokenMetadata.priority} desc, ${tokenMetadata.fetchedAt} desc`)
    .limit(limit);
  const website = opts.website ?? checkWebsite;
  const github = opts.github ?? checkGithub;
  for (const r of rows) {
    const claims = r.data ? extractClaims(r.data as Record<string, unknown>) : null;
    const checks: UrlCheckResult[] = [];
    const site = claims?.website;
    if (site && site.startsWith("https://")) {
      if (parseGithubRepo(site)) checks.push(await github(site, r.token));
      else checks.push(await website("website", site, r.token));
    }
    for (const c of checks) {
      c.evidence = { ...c.evidence, detail: [c.evidence.detail, "Link taken from the creator's launch metadata (a creator claim)."].filter(Boolean).join(" ") };
    }
    if (checks.length)
      await db.insert(verificationChecks).values(
        checks.map((c) => ({
          chainId,
          tokenAddress: r.token,
          checkType: `metadata_${c.type}`,
          status: c.state,
          evidence: c,
          observedAt: new Date(c.evidence.observedAt),
        })),
      );
    await db
      .update(tokenMetadata)
      .set({ enrichedAt: new Date() })
      .where(and(eq(tokenMetadata.chainId, chainId), eq(tokenMetadata.tokenAddress, r.token)));
    if (checks.length) log("info", "indexer.metadata_enriched", { chainId, token: getAddress(r.token), checks: checks.map((c) => `${c.type}:${c.state}`) });
  }
}

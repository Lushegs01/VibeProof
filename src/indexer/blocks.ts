import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Block } from "viem";
import type { ChainProvider } from "../lib/chain/provider";
import { schema, type DB } from "../lib/db/client";
import type { HeaderRow, HeaderStore } from "./timestamps";
import type { Db } from "./state";

const { chainBlocks } = schema;

/** chain_blocks-backed header cache: timestamps survive across serverless invocations. */
export class DbHeaderStore implements HeaderStore {
  constructor(
    private db: DB,
    private chainId: number,
  ) {}
  async load(blocks: bigint[]) {
    const out = new Map<bigint, number>();
    for (let i = 0; i < blocks.length; i += 5_000) {
      const rows = await this.db
        .select({ n: chainBlocks.blockNumber, t: chainBlocks.timestamp })
        .from(chainBlocks)
        .where(and(eq(chainBlocks.chainId, this.chainId), inArray(chainBlocks.blockNumber, blocks.slice(i, i + 5_000))));
      for (const r of rows) out.set(r.n, Math.floor(r.t.getTime() / 1000));
    }
    return out;
  }
  async save(rows: HeaderRow[]) {
    for (let i = 0; i < rows.length; i += 2_000)
      await this.db
        .insert(chainBlocks)
        .values(rows.slice(i, i + 2_000).map((r) => ({ chainId: this.chainId, blockNumber: r.number, blockHash: r.hash, parentHash: r.parentHash, timestamp: new Date(r.timestamp * 1000) })))
        .onConflictDoNothing();
  }
}

export type Checkpoint = { blockNumber: bigint; blockHash: string; parentHash: string };

/** Record the header of a committed range end (inside the range's transaction). */
export async function writeCheckpoint(db: Db, chainId: number, header: Block) {
  if (header.number === null || !header.hash) throw new Error("cannot checkpoint a pending block");
  await db
    .insert(chainBlocks)
    .values({ chainId, blockNumber: header.number, blockHash: header.hash, parentHash: header.parentHash, timestamp: new Date(Number(header.timestamp) * 1000), checkpoint: true })
    .onConflictDoUpdate({
      target: [chainBlocks.chainId, chainBlocks.blockNumber],
      set: { blockHash: header.hash, parentHash: header.parentHash, timestamp: new Date(Number(header.timestamp) * 1000), checkpoint: true, observedAt: new Date() },
    });
}

export async function storedBlock(db: Db, chainId: number, blockNumber: bigint) {
  const [row] = await db.select().from(chainBlocks).where(and(eq(chainBlocks.chainId, chainId), eq(chainBlocks.blockNumber, blockNumber)));
  return row ?? null;
}

/** Most recent checkpoints, newest first. */
export async function recentCheckpoints(db: Db, chainId: number, limit: number) {
  return db.select().from(chainBlocks).where(and(eq(chainBlocks.chainId, chainId), eq(chainBlocks.checkpoint, true))).orderBy(desc(chainBlocks.blockNumber)).limit(limit);
}

/** Forget headers above `block` (after a reorg rollback). */
export async function deleteBlocksAbove(db: Db, chainId: number, block: bigint) {
  await db.delete(chainBlocks).where(and(eq(chainBlocks.chainId, chainId), gt(chainBlocks.blockNumber, block)));
}

/** Keep the checkpoint table small: only the newest `keep` checkpoints stay flagged. */
export async function pruneCheckpoints(db: Db, chainId: number, keep = 256) {
  await db.execute(sql`
    update chain_blocks set checkpoint = false
    where chain_id = ${chainId} and checkpoint and block_number < (
      select coalesce(min(block_number), 0) from (
        select block_number from chain_blocks where chain_id = ${chainId} and checkpoint order by block_number desc limit ${keep}
      ) k)`);
}

/** Fresh header for a block number (never cached: used for canonicality checks). */
export async function canonicalHeader(provider: ChainProvider, blockNumber: bigint) {
  return provider.getBlock({ blockNumber });
}

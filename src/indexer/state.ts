import { eq, sql } from "drizzle-orm";
import type { DB } from "../lib/db/client";
import { schema } from "../lib/db/client";
import { log } from "../lib/util/log";

const { indexerState } = schema;

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Db = DB | Tx;

/** Thrown when a cursor moved underneath us: another writer is active, so nothing may be committed. */
export class CursorConflictError extends Error {
  constructor(
    readonly key: string,
    readonly expected: bigint | null,
  ) {
    super(`Cursor ${key} is not at ${expected ?? "unset"}; another indexer wrote to it. Aborting this range.`);
    this.name = "CursorConflictError";
  }
}

export async function getCursor(db: Db, key: string): Promise<bigint | null> {
  const [row] = await db.select().from(indexerState).where(eq(indexerState.key, key));
  return row?.lastBlock ?? null;
}

/** Read a cursor and lock its row until the end of the transaction. */
export async function lockCursor(tx: Tx, key: string): Promise<bigint | null> {
  const rows = await tx.execute<{ last_block: string }>(sql`select last_block::text from indexer_state where key = ${key} for update`);
  const r = [...rows][0];
  return r ? BigInt(r.last_block) : null;
}

/**
 * Compare-and-set cursor advance, inside the same transaction as the range's writes.
 * `expected === null` means "the cursor must not exist yet". If the stored value differs, the
 * transaction is aborted with CursorConflictError: data is committed if and only if the cursor
 * moves exactly from the range start to the range end.
 */
export async function advanceCursor(tx: Tx, key: string, expected: bigint | null, next: bigint) {
  if (expected === null) {
    const rows = await tx.insert(indexerState).values({ key, lastBlock: next }).onConflictDoNothing().returning({ key: indexerState.key });
    if (!rows.length) throw new CursorConflictError(key, expected);
  } else {
    const rows = await tx
      .update(indexerState)
      .set({ lastBlock: next, updatedAt: new Date() })
      .where(sql`${indexerState.key} = ${key} and ${indexerState.lastBlock} = ${expected}`)
      .returning({ key: indexerState.key });
    if (!rows.length) throw new CursorConflictError(key, expected);
  }
  log("debug", "indexer.cursor_advanced", { key, from: expected, to: next });
}

/** Unconditional write. Only for initialisation and reorg rewinds (which run under the indexer lock). */
export async function setCursor(db: Db, key: string, block: bigint) {
  await db.insert(indexerState).values({ key, lastBlock: block }).onConflictDoUpdate({ target: indexerState.key, set: { lastBlock: block, updatedAt: new Date() } });
}

export const cursorKeys = (chainId: number) => ({
  activity: `activity:${chainId}`,
  activityStart: `activity_start:${chainId}`,
  /** vibe keeps the original key format so existing databases resume where they were. */
  launches: (launchpad: string, deploymentId: string) => (launchpad === "vibe" ? `launches:${chainId}:${deploymentId}` : `launches:${chainId}:${launchpad}:${deploymentId}`),
  prefix: `:${chainId}`,
});

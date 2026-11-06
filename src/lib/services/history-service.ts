import { and, desc, eq, sql } from "drizzle-orm";
import type { Address } from "viem";
import type { ContractAnalysis } from "../analysis/contract";
import { getDb, schema, type DB } from "../db/client";
import type { ChainProvider } from "../chain/provider";
/** Unknown values never generate a claim of ownership or implementation change. */
export function contractChanges(previous: ContractAnalysis, current: ContractAnalysis) {
  const fields = [
    ["implementation", previous.proxy.implementation, current.proxy.implementation],
    ["owner", previous.owner, current.owner],
    ["admin", previous.proxy.admin, current.proxy.admin],
  ] as const;
  return fields.flatMap(([field, before, after]) =>
    before !== null && after !== null && before.toLowerCase() !== after.toLowerCase() ? [{ field, before, after }] : [],
  );
}
export async function storeContractObservation(tx: DB, provider: ChainProvider, address: Address, analysis: ContractAnalysis) {
  const c = provider.chainId,
    token = address.toLowerCase(),
    block = await provider.getBlock({ blockNumber: BigInt(analysis.block) });
  if (!block.hash) throw new Error("Canonical block hash unavailable for observation");
  const [previous] = await tx
    .select()
    .from(schema.contractObservations)
    .where(and(eq(schema.contractObservations.chainId, c), eq(schema.contractObservations.tokenAddress, token)))
    .orderBy(desc(schema.contractObservations.blockNumber))
    .limit(1);
  // An older concurrent analysis cannot replace a newer observation or emit backwards changes.
  if (previous && previous.blockNumber > BigInt(analysis.block)) return;
  const inserted = await tx
    .insert(schema.contractObservations)
    .values({ chainId: c, tokenAddress: token, blockNumber: BigInt(analysis.block), blockHash: block.hash, analysis })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length || !previous) return;
  if ((await provider.getBlock({ blockNumber: previous.blockNumber })).hash !== previous.blockHash) return;
  for (const change of contractChanges(previous.analysis as ContractAnalysis, analysis))
    await tx.insert(schema.feedEvents).values({
      chainId: c,
      tokenAddress: token,
      kind: `${change.field}_changed`,
      message: `Observed ${change.field} changed from ${change.before} to ${change.after}`,
      blockNumber: BigInt(analysis.block),
      data: {
        source: "RPC observations at canonical blocks",
        previousBlock: previous.blockNumber.toString(),
        block: analysis.block,
        blockHash: block.hash,
        before: change.before,
        after: change.after,
        limitation: "Observation time is not the exact change time; intermediate changes may not be observed.",
      },
    });
}
export async function creatorTimeline(wallet: string, chainId: number, limit = 100) {
  const db = getDb();
  if (!db) return [];
  const rows = await db.execute<{ kind: string; token: string; at: Date; tx_hash: string | null; data: unknown }>(sql`
    select f.kind,f.token_address as token,f.created_at as at,f.tx_hash,f.data from feed_events f join launches l on l.chain_id=f.chain_id and l.token_address=f.token_address where l.chain_id=${chainId} and l.creator_address=${wallet.toLowerCase()} and f.kind in ('launch','graduation','proof','control_verified','control_expired','control_revoked','implementation_changed','owner_changed','admin_changed') order by f.created_at desc,f.id desc limit ${limit}`);
  return [...rows].map((r) => ({ kind: r.kind, token: r.token, at: new Date(r.at).toISOString(), txHash: r.tx_hash, evidence: r.data }));
}

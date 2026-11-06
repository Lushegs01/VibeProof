import { eq } from "drizzle-orm";
import { keccak256, toBytes } from "viem";
import { getDb, schema } from "@/lib/db/client";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return new Response("Invalid hash", { status: 400 });
  const db = getDb();
  if (!db) return new Response("Storage unavailable", { status: 503 });
  const [row] = await db.select().from(schema.proofDocuments).where(eq(schema.proofDocuments.hash, hash));
  if (!row) return new Response("Document not found", { status: 404 });
  if (keccak256(toBytes(row.canonical)) !== hash) return new Response("Stored document integrity failure", { status: 500 });
  return new Response(row.canonical, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      etag: `"${hash}"`,
    },
  });
}

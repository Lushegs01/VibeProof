import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runIndexerJob } from "@/indexer/job";
import { log } from "@/lib/util/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel caps this by plan; the job stops ~30s before it to commit and release the lock.
export const maxDuration = 300;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Scheduled indexer run. Called by Vercel Cron (which sends `Authorization: Bearer $CRON_SECRET`)
 * or by the GitHub Actions workflow in .github/workflows/indexer-cron.yml.
 */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: { code: "not_configured", message: "CRON_SECRET is not set" } }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: { code: "unauthorized", message: "Invalid cron credentials" } }, { status: 401 });
  const budgetMs = Math.max(10_000, (Number(process.env.INDEXER_JOB_BUDGET_S ?? maxDuration) - 30) * 1000);
  try {
    const result = await runIndexerJob({ budgetMs, recheckProofs: true });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    log("error", "indexer.job_failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: { code: "job_failed", message: "Indexer run failed; see function logs." } }, { status: 500 });
  }
}

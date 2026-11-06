import { isDemoMode } from "@/lib/demo/mode";
import { cronAuthorized } from "@/lib/auth/cron";
import { jobHttpStatus } from "@/indexer/result";
import { redactSecrets } from "@/lib/chain/rpc-errors";
import { NextResponse } from "next/server";
import { runIndexerJob } from "@/indexer/job";
import { enqueueWebhookEvents, deliverWebhooks } from "@/lib/developer/webhooks";
import { recheckControls } from "@/lib/proof/challenges";
import { monitorOperations } from "@/lib/services/operations-service";
import { log } from "@/lib/util/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel caps this by plan; the job reserves 90s before it to commit and release the lock.
export const maxDuration = 300;

/**
 * Scheduled indexer run. Called by Vercel Cron (which sends `Authorization: Bearer $CRON_SECRET`)
 * or by the GitHub Actions workflow in .github/workflows/indexer-cron.yml.
 */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: { code: "not_configured", message: "CRON_SECRET is not set" } }, { status: 503 });
  if (!cronAuthorized(req)) return NextResponse.json({ error: { code: "unauthorized", message: "Invalid cron credentials" } }, { status: 401 });
  if (isDemoMode()) return NextResponse.json({ status: "skipped", reason: "demo mode never indexes live data" }, { status: 503 });
  const configured = Number(process.env.INDEXER_JOB_BUDGET_S ?? maxDuration);
  if (!Number.isFinite(configured) || configured < 120 || configured > maxDuration)
    return NextResponse.json({ error: { code: "invalid_budget" } }, { status: 503 });
  const budgetMs = (configured - 90) * 1000;
  try {
    let result;
    try {
      result = await runIndexerJob({ budgetMs, recheckProofs: true });
      await recheckControls(1);
      await enqueueWebhookEvents();
      await deliverWebhooks(2);
    } finally {
      // Dependency and maintenance failures must still reach operational monitoring.
      const monitored = await monitorOperations();
      if (monitored.monitoringStatus !== "ok") throw new Error("Operational alert delivery is degraded");
    }
    return NextResponse.json(result, { status: jobHttpStatus(result.status), headers: { "cache-control": "no-store" } });
  } catch (e) {
    log("error", "indexer.job_failed", { error: redactSecrets(e instanceof Error ? e.message : String(e)) });
    return NextResponse.json({ error: { code: "job_failed", message: "Indexer run failed; see function logs." } }, { status: 500 });
  }
}

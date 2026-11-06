import { cronAuthorized } from "@/lib/auth/cron";
import { isDemoMode } from "@/lib/demo/mode";
import { monitorOperations } from "@/lib/services/operations-service";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Separate external scheduler can observe outages even when indexing itself fails. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!cronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (isDemoMode()) return Response.json({ error: "demo_mode" }, { status: 403 });
  try {
    const report = await monitorOperations();
    return Response.json(
      { status: report.health.status, monitoring: report.monitoringStatus, checkedAt: report.health.checkedAt },
      { status: report.health.status === "ok" && report.monitoringStatus === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "monitoring_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

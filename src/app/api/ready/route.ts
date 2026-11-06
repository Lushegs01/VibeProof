import { isDemoMode } from "@/lib/demo/mode";
import { healthReport } from "@/lib/services/health-service";
import { isReady } from "@/lib/services/readiness";
export const dynamic = "force-dynamic";
export async function GET() {
  if (isDemoMode()) return Response.json({ status: "not_ready", demo: true }, { status: 503, headers: { "cache-control": "no-store" } });
  try {
    const { body } = await healthReport();
    const ready = !body.demo && isReady(body.database, body.redis, body.networks);
    return Response.json(
      { status: ready ? "ready" : "not_ready", checkedAt: body.checkedAt },
      { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503 });
  }
}

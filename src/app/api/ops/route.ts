import { isDemoMode } from "@/lib/demo/mode";
import { cronAuthorized } from "@/lib/auth/cron";
import { operationsReport } from "@/lib/services/operations-service";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (isDemoMode()) return Response.json({ error: "demo_mode" }, { status: 403 });
  return Response.json(await operationsReport(), { headers: { "cache-control": "no-store" } });
}

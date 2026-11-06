import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/services/operations-service", () => ({ monitorOperations: vi.fn() }));
vi.mock("@/indexer/job", () => ({ runIndexerJob: vi.fn() }));
vi.mock("@/lib/developer/webhooks", () => ({ enqueueWebhookEvents: vi.fn(), deliverWebhooks: vi.fn() }));
vi.mock("@/lib/proof/challenges", () => ({ recheckControls: vi.fn() }));
vi.mock("@/lib/auth/cron", () => ({ cronAuthorized: () => true }));
import { runIndexerJob } from "@/indexer/job";
import { monitorOperations } from "@/lib/services/operations-service";
import { GET as index } from "@/app/api/cron/indexer/route";
import { GET as monitor } from "@/app/api/cron/monitor/route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("monitors even when indexing throws and reports independent monitor degradation", async () => {
  vi.stubEnv("CRON_SECRET", "fixture-monitoring-only");
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.mocked(runIndexerJob).mockRejectedValue(new Error("database unavailable"));
  vi.mocked(monitorOperations).mockResolvedValue({ health: { status: "ok", checkedAt: new Date().toISOString() }, monitoringStatus: "degraded" } as Awaited<
    ReturnType<typeof monitorOperations>
  >);
  expect((await index(new Request("https://app.example/api/cron/indexer"))).status).toBe(500);
  expect(monitorOperations).toHaveBeenCalledTimes(1);
  const response = await monitor(new Request("https://app.example/api/cron/monitor"));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ monitoring: "degraded" });
});

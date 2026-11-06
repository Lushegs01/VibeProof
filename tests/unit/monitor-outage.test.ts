import { expect, it, vi } from "vitest";
vi.mock("@/lib/db/client", () => ({ getDb: () => null, schema: {} }));
vi.mock("@/lib/services/health-service", () => ({ healthReport: async () => ({ body: { database: "error", redis: "error", networks: [], status: "down" } }) }));
vi.mock("@/lib/services/alert-delivery", () => ({
  emergencyOperationalAlert: vi.fn(async () => {}),
  deliverOperationalAlerts: vi.fn(async () => ({ failed: 0, delivered: 0, attempted: 0 })),
}));
import { monitorOperations } from "@/lib/services/operations-service";
import { emergencyOperationalAlert } from "@/lib/services/alert-delivery";
it("surfaces a missing database and invokes the independent emergency adapter", async () => {
  await expect(monitorOperations()).rejects.toThrow("Operational monitoring failed");
  expect(emergencyOperationalAlert).toHaveBeenCalledTimes(1);
});

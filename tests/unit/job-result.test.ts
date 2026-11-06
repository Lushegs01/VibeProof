import { describe, expect, it } from "vitest";
import { executionStatus, jobHttpStatus } from "@/indexer/result";
import { isReady } from "@/lib/services/readiness";
describe("honest operational states", () => {
  it("never reports complete failures or empty configuration as success", () => {
    expect(executionStatus([{ status: "error" }, { status: "error" }])).toBe("failed");
    expect(executionStatus([])).toBe("failed");
    expect(jobHttpStatus("failed")).toBe(500);
  });
  it("keeps network and worker partial failures visible", () => {
    expect(executionStatus([{ status: "ok" }, { status: "error" }])).toBe("partial_success");
    expect(executionStatus([{ status: "ok", backfillFailed: 1 }])).toBe("partial_success");
    expect(executionStatus([{ status: "ok", metadataFailed: 1 }])).toBe("partial_success");
    expect(executionStatus([{ status: "ok", failures: ["metadata failed"] }])).toBe("partial_success");
    expect(jobHttpStatus("partial_success")).toBe(503);
  });
  it("distinguishes a lock skip, exhausted budget, and a zero-work successful tick", () => {
    expect(executionStatus([{ status: "skipped", reason: "another indexer run holds the lock" }])).toBe("skipped");
    expect(executionStatus([{ status: "skipped", reason: "time budget spent" }])).toBe("failed");
    expect(executionStatus([{ status: "ok" }])).toBe("success");
  });
  it("requires fresh data and every configured RPC chain match for readiness", () => {
    const healthy = { rpc: { status: "ok", chainIdMatches: true }, indexer: { status: "healthy" } };
    expect(isReady("ok", "ok", [healthy], true)).toBe(true);
    expect(isReady("ok", "ok", [{ ...healthy, indexer: { status: "stale" } }], true)).toBe(false);
    expect(isReady("ok", "error", [healthy], true)).toBe(false);
    expect(isReady("ok", "ok", [{ ...healthy, rpc: { status: "ok", chainIdMatches: null } }], true)).toBe(false);
  });
});

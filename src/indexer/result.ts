/** Execution and progress are separate: a caught-up zero-work run is successful. */
export type JobStatus = "success" | "partial_success" | "skipped" | "failed";
export type Execution = { status: "ok" | "error" | "skipped"; reason?: string; backfillFailed?: number; metadataFailed?: number; failures?: string[] };

export function executionStatus(results: Execution[]): JobStatus {
  if (!results.length) return "failed";
  const completed = results.filter((r) => r.status === "ok");
  const failures = results.some(
    (r) =>
      r.status === "error" ||
      (r.backfillFailed ?? 0) > 0 ||
      (r.metadataFailed ?? 0) > 0 ||
      r.failures?.length ||
      (r.status === "skipped" && !r.reason?.includes("holds the lock")),
  );
  if (!completed.length) return results.every((r) => r.status === "skipped" && r.reason?.includes("holds the lock")) ? "skipped" : "failed";
  return failures ? "partial_success" : "success";
}

export function jobHttpStatus(status: JobStatus) {
  return status === "failed" ? 500 : status === "partial_success" ? 503 : 200;
}

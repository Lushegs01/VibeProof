import { pathToFileURL } from "node:url";
import { schedulerConfig, SchedulerError, readSchedulerBody } from "./trigger-indexer.mjs";
export async function triggerMonitor(env, fetcher = fetch) {
  const config = schedulerConfig(env),
    url = new URL("/api/cron/monitor", config.url);
  let response;
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${config.secret}` }, redirect: "error", signal: AbortSignal.timeout(70000) });
  } catch (error) {
    throw new SchedulerError(["AbortError", "TimeoutError"].includes(error?.name) ? "timeout" : "transport", "Operational probe did not complete.");
  }
  if (response.status === 401 || response.status === 403) throw new SchedulerError("authentication", "Operational probe credentials were rejected.");
  if (!response.ok) throw new SchedulerError("execution", `Operational probe returned HTTP ${response.status}.`);
  const body = await readSchedulerBody(response);
  if (body.status !== "ok" || body.monitoring !== "ok" || !Number.isFinite(Date.parse(body.checkedAt)))
    throw new SchedulerError("execution", "Operational probe did not confirm healthy dependencies and alert delivery.");
  return { status: body.status, monitoring: body.monitoring, checkedAt: body.checkedAt };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await triggerMonitor(process.env)));
  } catch (error) {
    console.error(
      `Operational scheduler ${error instanceof SchedulerError ? error.kind : "unexpected"} failure: ${error instanceof SchedulerError ? error.message : "See protected operational report."}`,
    );
    process.exitCode = 1;
  }
}

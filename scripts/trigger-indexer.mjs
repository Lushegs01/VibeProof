import { pathToFileURL } from "node:url";

export class SchedulerError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}
export function schedulerConfig(env) {
  if (!env.VIBEPROOF_URL || !env.CRON_SECRET || env.CRON_SECRET.length < 16)
    throw new SchedulerError("configuration", "Set VIBEPROOF_URL and CRON_SECRET (16+ characters) repository secrets.");
  let url;
  try {
    url = new URL(env.VIBEPROOF_URL);
  } catch {
    throw new SchedulerError("configuration", "VIBEPROOF_URL must be an HTTPS origin.");
  }
  const allowed = (env.VIBEPROOF_ALLOWED_HOSTS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !allowed.includes(url.hostname.toLowerCase())
  )
    throw new SchedulerError("configuration", "Destination must be an HTTPS origin on the exact VIBEPROOF_ALLOWED_HOSTS repository variable allowlist.");
  return { url: new URL("/api/cron/indexer", url), secret: env.CRON_SECRET };
}
export async function readSchedulerBody(response) {
  if (Number(response.headers.get("content-length") || 0) > 131072) throw new SchedulerError("response", "Oversized scheduler response.");
  // Bound streamed responses too; never echo untrusted response text to Actions logs.
  const reader = response.body?.getReader();
  if (!reader) throw new SchedulerError("response", "Missing scheduler response.");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 131072) {
      await reader.cancel();
      throw new SchedulerError("response", "Oversized scheduler response.");
    }
    chunks.push(value);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SchedulerError("response", "Scheduler target returned invalid JSON.");
  }
  return body;
}
export async function triggerIndexer(env, fetcher = fetch) {
  const cfg = schedulerConfig(env);
  let response;
  try {
    response = await fetcher(cfg.url, { headers: { authorization: `Bearer ${cfg.secret}` }, redirect: "error", signal: AbortSignal.timeout(330_000) });
  } catch (e) {
    throw new SchedulerError(e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : "transport", "Indexer request did not complete.");
  }
  if (response.status === 401 || response.status === 403)
    throw new SchedulerError("authentication", "Cron authentication failed; check matching application/repository secrets.");
  if (!response.ok) throw new SchedulerError("execution", `Indexer returned HTTP ${response.status}. See protected operational report.`);
  const body = await readSchedulerBody(response);
  if (body.status === "skipped" && body.reason === "another indexer run holds the lock") return { status: "skipped", reason: "concurrency_lock" };
  if (
    body.status !== "success" ||
    !Array.isArray(body.networks) ||
    !body.networks.length ||
    !body.networks.every(
      (n) =>
        n.status === "ok" &&
        Number.isInteger(n.chainId) &&
        /^\d+$/.test(n.head) &&
        /^\d+$/.test(n.activityThrough) &&
        /^\d+$/.test(n.lag) &&
        typeof n.madeProgress === "boolean" &&
        Number.isFinite(Date.parse(n.lastSuccessfulAt)),
    )
  )
    throw new SchedulerError("execution", "Indexer did not report a valid successful execution.");
  return {
    status: body.status,
    ms: body.ms,
    networks: body.networks.map((n) => ({
      network: n.network,
      chainId: n.chainId,
      previousIndexedBlock: n.previousIndexedBlock,
      activityThrough: n.activityThrough,
      head: n.head,
      lag: n.lag,
      newLaunches: n.newLaunches,
      newEvents: n.newEvents,
      backfilled: n.backfilled,
      metadataFetched: n.metadataFetched,
      backfillFailed: n.backfillFailed,
      madeProgress: n.madeProgress,
      lastSuccessfulAt: n.lastSuccessfulAt,
    })),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await triggerIndexer(process.env)));
  } catch (e) {
    console.error(
      `Indexer scheduler ${e instanceof SchedulerError ? e.kind : "unexpected"} failure: ${e instanceof SchedulerError ? e.message : "See application logs."}`,
    );
    process.exitCode = 1;
  }
}

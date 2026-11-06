import { desc, sql } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import { healthReport } from "./health-service";
import { metrics } from "../util/log";
import { emergencyOperationalAlert, deliverOperationalAlerts } from "./alert-delivery";
import { monitorSample, networkConditions, monitorSetting, type MonitorSample } from "./operations-policy";
import { evaluateAlert } from "./alert-service";

export async function operationsReport() {
  const db = getDb();
  const health = await healthReport();
  const [runs, alerts, evidence, samples, delivery] = db
    ? await Promise.all([
        db.select().from(schema.indexerRuns).orderBy(desc(schema.indexerRuns.createdAt)).limit(20),
        db.select().from(schema.operationalAlerts).limit(100),
        db.execute<{ chain_id: number; oldest_check: Date | null; stale_proofs: number }>(
          sql`select p.chain_id, min(c.last) as oldest_check, count(*)::int as stale_proofs from project_proofs p left join lateral (select max(observed_at) as last from verification_checks c where c.chain_id = p.chain_id and c.token_address = p.token_address) c on true where c.last is null or c.last < now() - interval '6 hours' group by p.chain_id`,
        ),
        db.execute<{ chain_id: number; observed_at: Date; metrics: MonitorSample }>(
          sql`select distinct on (chain_id) chain_id,observed_at,metrics from monitoring_samples where observed_at <= now() - make_interval(secs => ${monitorSetting("ALERT_TREND_WINDOW_S", 300, 1)}) order by chain_id,observed_at desc`,
        ),
        db.execute<{ status: string; count: number }>(sql`select status,count(*)::int as count from operational_alert_deliveries group by status`),
      ])
    : [[], [], [], [], []];
  return {
    health: health.body,
    runs,
    alerts,
    evidence: [...evidence],
    samples: [...samples].map((s) => ({ ...s.metrics, chainId: s.chain_id, observedAt: new Date(s.observed_at).toISOString() })),
    alertDelivery: Object.fromEntries([...delivery].map((s) => [s.status, s.count])),
  };
}
export async function monitorOperations() {
  let report: Awaited<ReturnType<typeof operationsReport>>;
  try {
    report = await operationsReport();
    await evaluateAlert("database", report.health.database !== "ok", "critical");
    await evaluateAlert("redis", report.health.redis !== "ok", "critical");
    const failed = report.runs.slice(0, 3);
    await evaluateAlert("scheduled_failures", failed.length === 3 && failed.every((r) => ["failed", "partial_success"].includes(r.status)), "critical");
    for (const n of report.health.networks) {
      const idx = n.indexer;
      const previous = report.samples.find((s) => s.chainId === n.chainId);
      for (const condition of networkConditions(n, previous)) await evaluateAlert(condition.key, condition.failing, condition.severity);
      const sample = monitorSample(n);
      await getDb()!
        .insert(schema.monitoringSamples)
        .values({ chainId: n.chainId, observedAt: new Date(sample.observedAt), metrics: sample })
        .onConflictDoNothing();
      const recentFailures = report.runs
        .slice(0, 3)
        .flatMap((r) => (r.report as { networks?: { network: string; error?: string; failures?: string[] }[] }).networks ?? [])
        .filter((r) => r.network === n.network);
      await evaluateAlert(
        `${n.network}:reorg_failures`,
        recentFailures.filter((r) => /reorg|rollback/i.test([r.error, ...(r.failures ?? [])].join(" "))).length >= 2,
        "critical",
      );
      if ("backfillQueue" in idx && idx.backfillQueue) {
        // A stationary cursor is a problem only when the chain is ahead, never at head.
        const successful = report.runs
          .flatMap((r) => (r.report as { networks?: { network: string; activityThrough?: string; status: string }[] }).networks ?? [])
          .filter((r) => r.network === n.network && r.status === "ok")
          .slice(0, 3);
        await evaluateAlert(
          `${n.network}:stalled_cursor`,
          (idx.lagBlocks ?? 0) > Number(process.env.HEALTH_MAX_LAG_BLOCKS ?? 2000) &&
            successful.length === 3 &&
            successful[0].activityThrough !== undefined &&
            successful.every((r) => r.activityThrough === successful[0].activityThrough),
        );
      }
    }
    const deliveryRun = await deliverOperationalAlerts();
    const [deliveryHealth] = await getDb()!.execute<{ problems: number }>(
      sql`select count(*)::int as problems from operational_alert_deliveries where status in ('pending','processing','dead') and last_error is not null`,
    );
    return {
      ...report,
      deliveryRun,
      deliveryProblems: deliveryHealth.problems,
      monitoringStatus: deliveryRun.failed || deliveryRun.exhausted || deliveryHealth.problems > 0 ? ("degraded" as const) : ("ok" as const),
    };
  } catch {
    metrics.inc("operations.monitor_failures");
    await emergencyOperationalAlert();
    throw new Error("Operational monitoring failed; see alert delivery and dependency status");
  }
}

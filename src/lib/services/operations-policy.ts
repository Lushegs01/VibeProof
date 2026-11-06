import type { ProviderStats } from "../chain/provider";
export type MonitorSample = { chainId: number; observedAt: string; deadLetters: number | null; backfillLag: number | null };
export type MonitorNetwork = {
  network: string;
  chainId: number;
  rpc: { status: string; chainIdMatches: boolean | null };
  indexer: {
    status: string;
    lagBlocks?: number | null;
    backfillQueue?: { dead: number };
    pendingBackfills?: number;
    metadata?: Record<string, number>;
    provider?: Partial<ProviderStats> | null;
    providerErrorRate5m?: number | null;
  };
};
export type Condition = { key: string; failing: boolean | null; severity: "warning" | "critical" };
export function monitorSetting(key: string, fallback: number, minimum = 0) {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`Invalid ${key}`);
  return value;
}
export function monitorSample(network: MonitorNetwork, now = Date.now()): MonitorSample {
  return {
    chainId: network.chainId,
    observedAt: new Date(now).toISOString(),
    deadLetters: network.indexer.backfillQueue?.dead ?? null,
    backfillLag: network.indexer.pendingBackfills ?? null,
  };
}
export function networkConditions(network: MonitorNetwork, previous: MonitorSample | undefined, now = Date.now()): Condition[] {
  const n = network,
    idx = n.indexer,
    sample = monitorSample(n, now);
  const age = previous ? (now - Date.parse(previous.observedAt)) / 1000 : NaN;
  const fresh =
    previous?.chainId === n.chainId &&
    Number.isFinite(age) &&
    age >= monitorSetting("ALERT_TREND_WINDOW_S", 300, 1) &&
    age <= monitorSetting("ALERT_TREND_MAX_AGE_S", 1800, 1);
  const growth = (field: "deadLetters" | "backfillLag", threshold: number) =>
    fresh && sample[field] !== null && previous?.[field] !== null && previous?.[field] !== undefined ? sample[field]! - previous![field]! >= threshold : null;
  const condition = (key: string, failing: boolean | null, severity: Condition["severity"] = "warning"): Condition => ({
    key: `${n.network}:${key}`,
    failing,
    severity,
  });
  const errors = idx.providerErrorRate5m,
    throttling = idx.provider?.window5m?.throttleRate;
  return [
    condition("heartbeat", ["stale", "not_started", "unavailable", "error"].includes(idx.status), "critical"),
    condition("rpc", n.rpc.status !== "ok" || n.rpc.chainIdMatches !== true, "critical"),
    condition("dead_letters", sample.deadLetters === null ? null : sample.deadLetters > monitorSetting("ALERT_MAX_DEAD_LETTERS", 0)),
    condition("dead_letter_growth", growth("deadLetters", monitorSetting("ALERT_DEAD_LETTER_GROWTH", 1, 1))),
    condition("backfill_lag", sample.backfillLag === null ? null : sample.backfillLag > monitorSetting("ALERT_MAX_PENDING_BACKFILLS", 10000)),
    condition("backfill_growth", growth("backfillLag", monitorSetting("ALERT_BACKFILL_GROWTH", 100, 1))),
    condition(
      "metadata",
      idx.metadata
        ? Object.entries(idx.metadata).some(([key, value]) => !["ok", "pending"].includes(key) && value > monitorSetting("ALERT_MAX_METADATA_FAILURES", 100))
        : null,
    ),
    condition("rpc_errors", errors === null || errors === undefined ? null : errors > monitorSetting("ALERT_MAX_RPC_ERROR_RATE", 0.25)),
    condition("rpc_throttling", throttling === null || throttling === undefined ? null : throttling > monitorSetting("ALERT_MAX_RPC_THROTTLE_RATE", 0.1)),
  ];
}

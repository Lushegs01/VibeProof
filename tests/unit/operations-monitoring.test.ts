import { afterEach, expect, it, vi } from "vitest";
import { RollingWindow } from "@/lib/util/rolling-window";
import { monitorSample, networkConditions, type MonitorNetwork } from "@/lib/services/operations-policy";
import { alertAdapter } from "@/lib/services/alert-delivery";
import { validWebhookSignature } from "@/lib/developer/webhooks";
import { createCaller } from "@/lib/chain/provider";
import type { safeFetch } from "@/lib/proof/safe-fetch";
const network: MonitorNetwork = {
  network: "robinhood-testnet",
  chainId: 46630,
  rpc: { status: "ok", chainIdMatches: true },
  indexer: { status: "healthy", backfillQueue: { dead: 0 }, pendingBackfills: 0, metadata: { ok: 10 }, providerErrorRate5m: null },
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("expires idle traffic rather than reporting a false healthy zero and bounds bucket storage", () => {
  let now = 1000;
  const window = new RollingWindow(() => now);
  expect(window.snapshot().errorRate).toBeNull();
  window.record({ error: true, throttled: true, ms: 40 });
  window.record({ retry: true, ms: 20 });
  expect(window.snapshot()).toMatchObject({ count: 2, errorRate: 0.5, throttleRate: 0.5, retryRate: 0.5, meanLatencyMs: 30 });
  for (let n = 0; n < 1000; n++) {
    now += 10000;
    window.record();
  }
  expect(window.snapshot().count).toBe(30);
  now += 300000;
  expect(window.snapshot()).toMatchObject({ count: 0, errorRate: null, meanLatencyMs: null });
});
it("counts terminal 429 attempts even when no retries remain", async () => {
  const caller = createCaller({ maxConcurrency: 1, policy: { baseMs: 0, maxMs: 0, maxAttempts: {} } });
  await expect(
    caller.call("eth_call", async () => {
      throw Object.assign(new Error("Too many requests"), { status: 429 });
    }),
  ).rejects.toThrow();
  expect(caller.telemetry.snapshot().rateLimited).toBe(1);
  expect(caller.telemetry.snapshot().window5m).toMatchObject({ count: 1, errors: 1, throttled: 1, throttleRate: 1, retries: 0 });
});
it("detects queue growth using a fresh, chain-bound baseline and keeps missing signals unknown", () => {
  const now = 1800000000000,
    previous = monitorSample(network, now - 300000);
  const current = { ...network, indexer: { ...network.indexer, backfillQueue: { dead: 2 }, pendingBackfills: 150 } };
  const get = (n: MonitorNetwork, prior = previous) => Object.fromEntries(networkConditions(n, prior, now).map((c) => [c.key.split(":")[1], c.failing]));
  expect(get(current)).toMatchObject({ dead_letters: true, dead_letter_growth: true, backfill_growth: true, rpc_errors: null, rpc_throttling: null });
  expect(get(current, { ...previous, observedAt: new Date(now - 1900000).toISOString() }).dead_letter_growth).toBeNull();
  expect(get({ ...network, indexer: { status: "unavailable" } })).toMatchObject({ heartbeat: true, dead_letters: null, backfill_growth: null });
  expect(get(current, { ...previous, chainId: 1 }).dead_letter_growth).toBeNull();
  expect(get(network)).toMatchObject({ heartbeat: false, dead_letter_growth: false, backfill_growth: false });
  vi.stubEnv("ALERT_MAX_RPC_ERROR_RATE", "NaN");
  expect(() => get({ ...network, indexer: { ...network.indexer, providerErrorRate5m: 0.5 } })).toThrow("Invalid");
});
it("posts signed exact alert bytes, rejects private destinations and refuses redirects or failures", async () => {
  const event = { key: "rpc", kind: "firing" as const, severity: "critical" as const, at: new Date().toISOString() };
  vi.stubEnv("ALERT_WEBHOOK_URL", "https://alerts.example/receiver");
  vi.stubEnv("ALERT_WEBHOOK_SECRET", "fixture-alert-signing-secret-not-production");
  const transport = vi.fn<typeof safeFetch>(async (url, options) => {
    expect(url).toBe("https://alerts.example/receiver");
    expect(options).toMatchObject({ method: "POST", maxRedirects: 0, allowHttp: false, timeoutMs: 5000 });
    const headers = options!.headers!,
      body = options!.body!.toString();
    expect(JSON.parse(body)).toEqual(event);
    expect(
      validWebhookSignature(
        process.env.ALERT_WEBHOOK_SECRET!,
        headers["x-vibeproof-id"],
        Number(headers["x-vibeproof-timestamp"]),
        body,
        headers["x-vibeproof-signature"].slice(3),
      ),
    ).toBe(true);
    return { status: 204, redirects: [], truncated: false } as unknown as Awaited<ReturnType<typeof safeFetch>>;
  });
  await alertAdapter(transport).deliver(event, "durable-id");
  expect(transport).toHaveBeenCalledTimes(1);
  for (const url of ["https://127.0.0.1/hook", "https://user:password@alerts.example/", "https://alerts.example/?token=private"]) {
    vi.stubEnv("ALERT_WEBHOOK_URL", url);
    expect(() => alertAdapter(transport)).toThrow();
  }
  vi.stubEnv("ALERT_WEBHOOK_URL", "https://alerts.example/receiver");
  await expect(alertAdapter(async () => ({ status: 503, redirects: [], truncated: false }) as never).deliver(event)).rejects.toThrow("503");
  await expect(alertAdapter(async () => ({ status: 302, redirects: [], truncated: false }) as never).deliver(event)).rejects.toThrow("302");
});

"use client";
import { useState, type FormEvent } from "react";
export default function OperationsPage() {
  const [key, setKey] = useState("");
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/ops", { headers: { authorization: `Bearer ${key}` }, cache: "no-store" });
      if (!r.ok) throw new Error(`Operational report unavailable (HTTP ${r.status})`);
      setReport(await r.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const delivery = report?.alertDelivery as Record<string, number> | undefined;
  const health = report?.health as
    | {
        status: string;
        networks: {
          network: string;
          rpc: { status: string; latencyMs: number; chainIdMatches: boolean | null };
          indexer: {
            status: string;
            heartbeatAgeSeconds?: number | null;
            provider?: { window5m?: { throttleRate: number | null; meanLatencyMs: number | null } } | null;
            headBlock: string | null;
            indexedThrough?: string | null;
            lagBlocks?: number | null;
            lastSuccessfulTickAt?: string | null;
            pendingBackfills?: number;
            failedBackfills?: number;
          };
        }[];
      }
    | undefined;
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl">Operations</h1>
      <p className="mt-3 text-fg-2">
        Protected network health, sync lag, queues, recent executions and evidence freshness. Credentials stay in this page’s memory.
      </p>
      <form onSubmit={load} className="my-6 flex gap-3">
        <label className="flex-1">
          Operations credential
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} className="input mt-2" required />
        </label>
        <button disabled={busy} className="btn btn-primary self-end px-5">
          {busy ? "Loading…" : "Refresh"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {health && (
        <section className="my-6">
          <h2 className="text-xl">System: {health.status}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {health.networks.map((n) => (
              <article key={n.network} className="rounded-xl border border-line p-5">
                <h3 className="font-medium">
                  {n.network} · {n.indexer.status}
                </h3>
                <dl className="mt-3 space-y-1 text-sm">
                  <div>
                    <dt className="inline">Indexed / head: </dt>
                    <dd className="inline">
                      {n.indexer.indexedThrough ?? "unknown"} / {n.indexer.headBlock ?? "unknown"}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Lag: </dt>
                    <dd className="inline">{n.indexer.lagBlocks ?? "unknown"} blocks</dd>
                  </div>
                  <div>
                    <dt className="inline">RPC: </dt>
                    <dd className="inline">
                      {n.rpc.status}, {n.rpc.latencyMs} ms, chain {n.rpc.chainIdMatches === true ? "matches" : "unverified"}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Backfills pending / failed: </dt>
                    <dd className="inline">
                      {n.indexer.pendingBackfills ?? "unknown"} / {n.indexer.failedBackfills ?? "unknown"}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Heartbeat age: </dt>
                    <dd className="inline">
                      {n.indexer.heartbeatAgeSeconds === null || n.indexer.heartbeatAgeSeconds === undefined
                        ? "unknown"
                        : `${n.indexer.heartbeatAgeSeconds} seconds`}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">RPC throttling (5 min): </dt>
                    <dd className="inline">
                      {n.indexer.provider?.window5m?.throttleRate === null || n.indexer.provider?.window5m?.throttleRate === undefined
                        ? "unknown"
                        : `${(n.indexer.provider.window5m.throttleRate * 100).toFixed(1)}%`}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Last success: </dt>
                    <dd className="inline">{n.indexer.lastSuccessfulTickAt ?? "never observed"}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}
      {delivery && (
        <section className="my-6 rounded-xl border border-line p-5">
          <h2 className="text-xl">Alert delivery</h2>
          <dl className="mt-3 flex flex-wrap gap-5">
            {["pending", "processing", "delivered", "dead"].map((status) => (
              <div key={status}>
                <dt className="capitalize">{status === "dead" ? "Exhausted" : status}</dt>
                <dd className="font-mono text-lg">{delivery[status] ?? 0}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-fg-2">
            Pending deliveries retry automatically. Exhausted deliveries require operator review; monitoring reports a degraded state while they remain
            unresolved.
          </p>
        </section>
      )}
      {report &&
        Object.entries(report).map(([section, value]) => (
          <section key={section} className="my-6 rounded-xl border border-line p-5">
            <h2 className="text-xl capitalize">{section}</h2>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre>
          </section>
        ))}
    </main>
  );
}

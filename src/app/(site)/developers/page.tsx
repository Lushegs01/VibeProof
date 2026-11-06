"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export default function DevelopersPage() {
  const [account, setAccount] = useState<{ plan: string; subscriptionState: string; usage: unknown[]; limits: unknown } | null>(null);
  const [message, setMessage] = useState("");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [webhooks, setWebhooks] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch("/api/account");
    if (r.ok) setAccount((await r.json()).data);
    else setMessage("Sign in with your wallet on Submit proof to manage your developer account.");
    const hooks = await fetch("/api/developer/webhooks");
    if (hooks.ok) setWebhooks((await hooks.json()).data);
  }
  useEffect(() => {
    void load();
  }, []);
  async function submit(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Request failed");
      return j.data;
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-4xl px-6 py-14">
      <h1 className="text-3xl">Developer account</h1>
      <p className="mt-3 text-fg-2">Public evidence remains available on every plan. Paid capacity never changes verification outcomes.</p>
      <p className="mt-3 text-sm">
        <Link href="/submit" className="text-accent">
          Sign in with Ethereum
        </Link>{" "}
        ·{" "}
        <a href="/api/v1/openapi" className="text-accent">
          OpenAPI reference
        </a>{" "}
        ·{" "}
        <Link href="/watchlist" className="text-accent">
          Wallet watchlist
        </Link>
      </p>
      {message && (
        <p role="status" className="my-4">
          {message}
        </p>
      )}
      {account && (
        <>
          <section className="my-8 rounded-xl border border-line p-6">
            <h2 className="text-xl">
              {account.plan} · {account.subscriptionState}
            </h2>
            <pre className="mt-3 overflow-auto text-sm">{JSON.stringify({ limits: account.limits, usage: account.usage }, null, 2)}</pre>
            <p className="mt-3 text-sm text-fg-2">Billing is in test mode. Checkout creates a test reference; it does not charge or change your plan.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {["professional", "developer", "enterprise"].map((plan) => (
                <button
                  key={plan}
                  disabled={busy}
                  className="btn btn-outline px-4"
                  onClick={async () => {
                    const result = await submit("/api/account", { plan });
                    if (result) setMessage(`Test checkout: ${result.reference}. Contact the operator to join the pilot; no payment was taken.`);
                  }}
                >
                  Preview {plan} upgrade
                </button>
              ))}
            </div>
          </section>
          <section className="my-8 rounded-xl border border-line p-6">
            <h2 className="text-xl">Developer credential</h2>
            <label className="mt-3 block">
              Label
              <input className="input mt-2" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
            </label>
            <button
              className="btn btn-outline mt-3 px-4"
              disabled={busy || !label}
              onClick={async () => {
                const result = await submit("/api/developer/keys", { label });
                if (result) setKey(result.key);
              }}
            >
              Create credential
            </button>
            {key && (
              <p role="status" className="mt-4 break-all font-mono text-xs">
                Shown once: {key}
              </p>
            )}
            <p className="mt-3 text-sm text-fg-2">
              Send Authorization: Bearer vp_… to API v1. Credential IDs and revocation are available at /api/developer/keys.
            </p>
          </section>
          <section className="my-8 rounded-xl border border-line p-6">
            <h2 className="text-xl">Signed webhooks</h2>
            <p className="mt-2 text-sm text-fg-2">
              Requires webhook capacity and a public HTTPS receiver that echoes the endpoint challenge. Watches are scoped to your wallet and network.
            </p>
            <label className="mt-3 block">
              Receiver URL
              <input type="url" className="input mt-2" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
            </label>
            <button
              className="btn btn-outline mt-3 px-4"
              disabled={busy || !endpoint}
              onClick={async () => {
                const result = await submit("/api/developer/webhooks", {
                  endpoint,
                  filters: ["proof", "graduation", "implementation_changed", "owner_changed", "control_expired"],
                });
                if (result) {
                  setMessage(`Webhook ${result.id} pending ownership confirmation. Save signing secret: ${result.secret}`);
                  await load();
                }
              }}
            >
              Create endpoint challenge
            </button>
            <pre className="mt-4 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(webhooks, null, 2)}</pre>
          </section>
        </>
      )}
    </main>
  );
}

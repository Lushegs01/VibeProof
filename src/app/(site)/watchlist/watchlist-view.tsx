"use client";
import Link from "next/link";
import { tokenPath, NETWORKS, type NetworkSlug } from "@/lib/chain/networks";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { readWatchlist, writeWatchlist } from "@/components/passport/client-bits";
import { formatInt, signed, timeAgo } from "@/lib/util/format";
import { shortAddress } from "@/lib/util/address";
type Item = ReturnType<typeof readWatchlist>[number];
type Live = { holders: number | null; events: number | null; state: "loading" | "ok" | "unavailable" };
const key = (w: Item) => `${w.chain}:${w.address.toLowerCase()}`;
export function WatchlistView() {
  const [items, setItems] = useState<Item[]>([]),
    [page, setPage] = useState(0),
    [live, setLive] = useState<Record<string, Live>>({});
  const [message, setMessage] = useState(""),
    [syncing, setSyncing] = useState(false);
  const [notifications, setNotifications] = useState<{ id: number; message: string; token: string; chainId: number }[]>([]);
  useEffect(() => setItems(readWatchlist()), []);
  useEffect(() => {
    const controller = new AbortController();
    const visible = items.slice(page * 20, page * 20 + 20);
    async function load() {
      for (let i = 0; i < visible.length; i += 4) {
        if (controller.signal.aborted) return;
        await Promise.all(
          visible.slice(i, i + 4).map(async (w) => {
            const k = key(w);
            setLive((s) => ({ ...s, [k]: { holders: null, events: null, state: "loading" } }));
            try {
              const [p, c] = await Promise.all([
                fetch(`/api/tokens/${w.address}?network=${w.chain}`, { signal: controller.signal }).then((r) => (r.ok ? r.json() : null)),
                fetch(`/api/tokens/${w.address}/changes?network=${w.chain}&since=${encodeURIComponent(w.lastCheckedAt)}`, { signal: controller.signal }).then(
                  (r) => (r.ok ? r.json() : null),
                ),
              ]);
              if (controller.signal.aborted) return;
              const holders = p?.data?.activity?.holders?.value ?? null;
              setLive((s) => ({ ...s, [k]: { holders, events: c?.data?.events?.length ?? null, state: holders === null ? "unavailable" : "ok" } }));
            } catch {
              if (!controller.signal.aborted) setLive((s) => ({ ...s, [k]: { holders: null, events: null, state: "unavailable" } }));
            }
          }),
        );
      }
    }
    void load();
    return () => controller.abort();
  }, [items, page]);
  async function mutation(w: Item, action: "add" | "remove" | "checked") {
    const r = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId: NETWORKS[w.chain].chainId, token: w.address, action }),
    });
    if (!r.ok && r.status !== 401) throw new Error((await r.json()).error?.message ?? "Wallet synchronization failed");
    return r;
  }
  async function sync() {
    setSyncing(true);
    setMessage("");
    try {
      const r = await fetch("/api/watchlist");
      if (!r.ok) throw new Error("Sign in from Submit proof to synchronize your wallet watchlist.");
      const remote = (await r.json()).data as { chainId: number; tokenAddress: string; createdAt: string; lastCheckedAt: string }[];
      for (const w of items) {
        const added = await mutation(w, "add");
        if (!added.ok) throw new Error("Session expired during sync. Sign in again; local entries are preserved.");
      }
      const merged = [...items];
      for (const w of remote) {
        const chain: NetworkSlug = w.chainId === 46630 ? "robinhood-testnet" : "robinhood-mainnet";
        if (!merged.some((i) => i.chain === chain && i.address.toLowerCase() === w.tokenAddress))
          merged.push({ chain, address: w.tokenAddress, symbol: null, addedAt: w.createdAt, lastHolders: null, lastCheckedAt: w.lastCheckedAt });
      }
      writeWatchlist(merged);
      setItems(merged);
      const n = await fetch("/api/notifications");
      if (n.ok) setNotifications((await n.json()).data.items);
      setMessage("Wallet watchlist synchronized. Local entries were preserved.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  function remove(w: Item) {
    const next = items.filter((x) => key(x) !== key(w));
    writeWatchlist(next);
    setItems(next);
    if (page > 0 && next.length <= page * 20) setPage(page - 1);
    void mutation(w, "remove").catch(() => setMessage("Removed locally; wallet synchronization failed."));
  }
  function checked(w: Item) {
    const next = items.map((x) =>
      key(x) === key(w) ? { ...x, lastHolders: live[key(w)]?.holders ?? x.lastHolders, lastCheckedAt: new Date().toISOString() } : x,
    );
    writeWatchlist(next);
    setItems(next);
    void mutation(w, "checked").catch(() => setMessage("Checked locally; wallet synchronization failed."));
  }
  return (
    <>
      <div className="mt-6">
        <button type="button" className="btn btn-outline px-5" disabled={syncing} onClick={sync}>
          {syncing ? "Syncing…" : "Sync with signed-in wallet"}
        </button>
        {message && (
          <p role="status" className="mt-2 text-sm">
            {message}
          </p>
        )}
        {notifications.length > 0 && (
          <ul className="mt-4 space-y-2">
            {notifications.map((n) => (
              <li key={n.id} className="text-sm">
                <Link href={tokenPath(n.token, n.chainId === 46630 ? "robinhood-testnet" : "robinhood-mainnet")} className="text-accent">
                  {n.message}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!items.length ? (
        <p className="mt-10 rounded-[20px] border border-line bg-surface/50 p-6 text-sm text-fg-2">
          Nothing watched yet. Open any Launch Passport and choose “Watch”.
        </p>
      ) : (
        <>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {items.slice(page * 20, page * 20 + 20).map((w) => {
              const l = live[key(w)],
                delta = l?.holders != null && w.lastHolders !== null ? l.holders - w.lastHolders : null;
              return (
                <li key={key(w)} className="rounded-[20px] border border-line bg-surface/50 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={tokenPath(w.address, w.chain)} onClick={() => checked(w)} className="text-lg font-medium hover:underline">
                      {w.symbol ? `$${w.symbol}` : shortAddress(w.address)}
                    </Link>
                    <button
                      type="button"
                      onClick={() => remove(w)}
                      aria-label={`Stop watching ${w.symbol ?? w.address}`}
                      className="rounded p-1 text-fg-2 hover:text-fg"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  {!l || l.state === "loading" ? (
                    <div className="skeleton mt-3 h-10" />
                  ) : l.state === "unavailable" ? (
                    <p className="mt-3 font-mono text-sm text-fg-2">Holders unavailable</p>
                  ) : (
                    <dl className="mt-3 space-y-1 font-mono text-sm">
                      <div>
                        <dt className="sr-only">Holders</dt>
                        <dd>{formatInt(l.holders)} holders</dd>
                      </div>
                      <div className="text-fg-2">
                        <dt className="sr-only">Change</dt>
                        <dd>{delta === null ? "No baseline" : `${signed(delta)} since last check`}</dd>
                      </div>
                      <div className="text-fg-2">
                        <dt className="sr-only">New events</dt>
                        <dd>{l.events === null ? "Events unavailable" : `${l.events} new event${l.events === 1 ? "" : "s"}`}</dd>
                      </div>
                    </dl>
                  )}
                  <p className="mt-3 text-xs text-muted">
                    {NETWORKS[w.chain].shortName} · Last checked {timeAgo(w.lastCheckedAt)}
                  </p>
                </li>
              );
            })}
          </ul>
          <nav aria-label="Watchlist pagination" className="mt-5 flex items-center gap-4">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="btn btn-outline px-4">
              Previous
            </button>
            <span className="text-sm">
              Page {page + 1} of {Math.ceil(items.length / 20)}
            </span>
            <button type="button" disabled={(page + 1) * 20 >= items.length} onClick={() => setPage((p) => p + 1)} className="btn btn-outline px-4">
              Next
            </button>
          </nav>
        </>
      )}
    </>
  );
}

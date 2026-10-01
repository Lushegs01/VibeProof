"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { readWatchlist, writeWatchlist } from "@/components/passport/client-bits";
import { formatInt, signed, timeAgo } from "@/lib/util/format";
import { shortAddress } from "@/lib/util/address";

type Live = { holders: number | null; events: number | null; state: "loading" | "ok" | "unavailable" };

export function WatchlistView() {
  const [items, setItems] = useState<ReturnType<typeof readWatchlist>>([]);
  const [live, setLive] = useState<Record<string, Live>>({});
  useEffect(() => {
    const list = readWatchlist();
    setItems(list);
    list.forEach(async (w) => {
      setLive((l) => ({ ...l, [w.address]: { holders: null, events: null, state: "loading" } }));
      try {
        const [p, c] = await Promise.all([fetch(`/api/tokens/${w.address}`).then((r) => r.json()), fetch(`/api/tokens/${w.address}/changes?since=${encodeURIComponent(w.lastCheckedAt)}`).then((r) => (r.ok ? r.json() : null))]);
        const holders = p?.data?.activity?.holders?.value ?? null;
        setLive((l) => ({ ...l, [w.address]: { holders, events: c?.data ? c.data.events.length : null, state: holders === null ? "unavailable" : "ok" } }));
      } catch {
        setLive((l) => ({ ...l, [w.address]: { holders: null, events: null, state: "unavailable" } }));
      }
    });
  }, []);

  const markChecked = (address: string) => {
    const next = items.map((w) => (w.address === address ? { ...w, lastHolders: live[address]?.holders ?? w.lastHolders, lastCheckedAt: new Date().toISOString() } : w));
    writeWatchlist(next);
    setItems(next);
  };
  const remove = (address: string) => {
    const next = items.filter((w) => w.address !== address);
    writeWatchlist(next);
    setItems(next);
  };

  if (!items.length) return <p className="mt-10 rounded-[20px] border border-line bg-surface/50 p-6 text-sm text-fg-2">Nothing watched yet. Open any Launch Passport and choose “Watch”.</p>;
  return (
    <ul className="mt-8 grid gap-3 sm:grid-cols-2">
      {items.map((w) => {
        const l = live[w.address];
        const delta = l?.holders !== null && l?.holders !== undefined && w.lastHolders !== null ? l.holders - w.lastHolders : null;
        return (
          <li key={w.address} className="rounded-[20px] border border-line bg-surface/50 bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/token/robinhood-testnet/${w.address}`} onClick={() => markChecked(w.address)} className="text-lg font-medium hover:underline">
                {w.symbol ? `$${w.symbol}` : shortAddress(w.address)}
              </Link>
              <button type="button" onClick={() => remove(w.address)} aria-label={`Stop watching ${w.symbol ?? w.address}`} className="rounded p-1 text-fg-2 hover:text-fg">
                <X className="size-4" />
              </button>
            </div>
            {l?.state === "loading" ? (
              <div className="skeleton mt-3 h-10" />
            ) : l?.state === "unavailable" ? (
              <p className="mt-3 font-mono text-sm text-fg-2">Holders unavailable</p>
            ) : (
              <dl className="mt-3 space-y-1 font-mono text-sm">
                <div>
                  <dt className="sr-only">Holders</dt>
                  <dd>{formatInt(l?.holders)} holders</dd>
                </div>
                <div className="text-fg-2">
                  <dt className="sr-only">Change</dt>
                  <dd>{delta === null ? "No baseline" : `${signed(delta)} since last check`}</dd>
                </div>
                <div className="text-fg-2">
                  <dt className="sr-only">New events</dt>
                  <dd>{l?.events === null || l?.events === undefined ? "Events unavailable" : `${l.events} new event${l.events === 1 ? "" : "s"}`}</dd>
                </div>
              </dl>
            )}
            <p className="mt-3 text-xs text-muted">Last checked {timeAgo(w.lastCheckedAt)}</p>
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import { Eye, EyeOff, Share2, Check, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChangesResponse } from "@/lib/services/types";
import { signed, timeAgo } from "@/lib/util/format";

// ── Local watchlist + last-visit memory (MVP: browser storage) ────────────────
type WatchItem = { address: string; symbol: string | null; addedAt: string; lastHolders: number | null; lastCheckedAt: string };
const WL_KEY = "vp:watchlist:v1";
const VISIT_KEY = (a: string) => `vp:visit:v1:${a.toLowerCase()}`;

export function readWatchlist(): WatchItem[] {
  try {
    return JSON.parse(localStorage.getItem(WL_KEY) ?? "[]");
  } catch {
    return [];
  }
}
export function writeWatchlist(items: WatchItem[]) {
  try {
    localStorage.setItem(WL_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable */
  }
}

export function WatchButton({ address, symbol, holders }: { address: string; symbol: string | null; holders: number | null }) {
  const [watching, setWatching] = useState(false);
  useEffect(() => setWatching(readWatchlist().some((w) => w.address.toLowerCase() === address.toLowerCase())), [address]);
  const toggle = () => {
    const list = readWatchlist();
    const next = watching ? list.filter((w) => w.address.toLowerCase() !== address.toLowerCase()) : [...list, { address, symbol, addedAt: new Date().toISOString(), lastHolders: holders, lastCheckedAt: new Date().toISOString() }];
    writeWatchlist(next);
    setWatching(!watching);
  };
  return (
    <button type="button" onClick={toggle} aria-pressed={watching} className="btn btn-outline h-10 px-5 text-sm">
      {watching ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      {watching ? "Watching" : "Watch"}
    </button>
  );
}

export function ShareButton({ address }: { address: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const share = async () => {
    setState("busy");
    try {
      const r = await fetch(`/api/tokens/${address}/share`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message);
      const url = `${location.origin}${j.data.path}`;
      if (navigator.share) await navigator.share({ url, title: "VibeProof Launch Passport" }).catch(() => navigator.clipboard.writeText(url));
      else await navigator.clipboard.writeText(url);
      setState("done");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  };
  return (
    <button type="button" onClick={share} disabled={state === "busy"} className="btn btn-primary h-10 px-5 text-sm">
      {state === "busy" ? <Loader2 className="size-4 animate-spin" /> : state === "done" ? <Check className="size-4" /> : <Share2 className="size-4" />}
      <span aria-live="polite">{state === "done" ? "Link copied" : state === "error" ? "Could not share" : "Share passport"}</span>
    </button>
  );
}

export function RefreshAnalysis({ address }: { address: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/tokens/${address}/contract?refresh=1`).catch(() => null);
        location.reload();
      }}
      className="inline-flex items-center gap-1.5 text-xs text-fg-2 hover:text-fg"
    >
      <RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} /> Re-run analysis
    </button>
  );
}

/** "Since your last visit" — compares a stored snapshot baseline with now. */
export function WhatChanged({ address }: { address: string }) {
  const [data, setData] = useState<ChangesResponse | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "first" | "unavailable">("loading");
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(VISIT_KEY(address));
      localStorage.setItem(VISIT_KEY(address), new Date().toISOString());
    } catch {
      /* ignore */
    }
    const s = last ?? new Date(Date.now() - 24 * 3600_000).toISOString();
    setSince(last);
    fetch(`/api/tokens/${address}/changes?since=${encodeURIComponent(s)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setData((await r.json()).data);
        setState(last ? "ready" : "first");
      })
      .catch(() => setState("unavailable"));
  }, [address]);

  if (state === "loading")
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-14" />
        ))}
      </div>
    );
  if (state === "unavailable" || !data) return <p className="text-sm text-fg-2">Change history is unavailable for this token (not yet covered by the indexer).</p>;
  const nonZero = data.diffs.filter((d) => d.delta !== 0);
  return (
    <div>
      <p className="mb-4 text-xs text-fg-2">
        {state === "first" ? "First visit: showing the last 24 hours." : `Since your last visit ${timeAgo(since)}.`}{" "}
        {data.baselineAt ? (data.baselineExact ? `Baseline snapshot ${timeAgo(data.baselineAt)}.` : `Earliest available snapshot is ${timeAgo(data.baselineAt)}; baseline is approximate.`) : "No earlier snapshot exists yet."}
      </p>
      {data.diffs.length ? (
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-[#5cc6ea2e] bg-[#5cc6ea1f] sm:grid-cols-4">
          {data.diffs.map((d) => (
            <li key={d.metric} className="bg-surface px-4 py-3">
              <div className={`font-mono text-lg tabular ${d.delta > 0 ? "text-fg" : "text-fg-2"}`}>{d.metric === "volume" ? `${d.delta >= 0 ? "+" : "−"}${Math.abs(d.delta).toFixed(4)}` : signed(d.delta)}</div>
              <div className="mt-0.5 text-xs text-fg-2">{d.label}</div>
            </li>
          ))}
        </ul>
      ) : null}
      {data.events.length ? (
        <ul className="mt-4 space-y-2 text-sm">
          {data.events.slice(0, 6).map((e, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="size-1.5 rounded-full bg-accent" aria-hidden />
              <span className="flex-1">{e.message}</span>
              <span className="font-mono text-xs text-fg-2">{timeAgo(e.at)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!nonZero.length && !data.events.length ? <p className="text-sm text-fg-2">No changes observed in this window.</p> : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { FeedItem } from "@/lib/services/discover-service";
import { shortAddress } from "@/lib/util/address";

const KIND: Record<string, string> = { launch: "Launch", proof: "Proof", creator_activity: "Creator", graduation: "Graduation", holders: "Holders" };

export function LiveFeed({ initial }: { initial: FeedItem[] }) {
  const [items, setItems] = useState(initial);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/activity");
        if (r.ok) setItems((await r.json()).data);
      } catch {
        /* keep last good state */
      }
    }, 8000);
    return () => clearInterval(t);
  }, [paused]);
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs text-fg-2">
          <span className={`size-1.5 rounded-full ${paused ? "bg-muted" : "animate-pulse-dot bg-accent"}`} aria-hidden />
          {paused ? "Paused" : "Refreshing every 8s"}
        </span>
        <button type="button" onClick={() => setPaused((p) => !p)} className="text-xs text-fg-2 hover:text-fg">
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
      <ol className="rounded-[20px] border border-line bg-surface/50" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((f) => (
            <motion.li key={f.id} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-[64px_1fr] gap-x-4 border-b border-line/70 px-4 py-3 last:border-b-0 sm:grid-cols-[64px_110px_1fr_auto]">
              <time dateTime={f.at} className="font-mono text-xs text-fg-2">
                {new Date(f.at).toISOString().slice(11, 16)}
              </time>
              <span className="label hidden sm:block">{KIND[f.kind] ?? f.kind}</span>
              <div className="min-w-0">
                <Link href={`/token/robinhood-testnet/${f.token}`} className="font-medium hover:underline">
                  {f.symbol ? `$${f.symbol}` : shortAddress(f.token)}
                </Link>
                <p className="truncate text-sm text-fg-2">{f.message}</p>
              </div>
              {f.txHash ? (
                <a href={`https://explorer.testnet.chain.robinhood.com/tx/${f.txHash}`} target="_blank" rel="noopener noreferrer" className="col-start-2 font-mono text-xs text-fg-2 hover:text-fg sm:col-start-auto">
                  {shortAddress(f.txHash, 4, 4)}
                </a>
              ) : (
                <span />
              )}
            </motion.li>
          ))}
        </AnimatePresence>
        {!items.length ? <li className="p-6 text-sm text-fg-2">No events yet.</li> : null}
      </ol>
    </div>
  );
}

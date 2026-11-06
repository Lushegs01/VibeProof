"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Search, CornerDownLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { SearchResult } from "@/lib/services/search-service";
import { shortAddress } from "@/lib/util/address";
import { cn } from "@/lib/util/cn";

const KIND_LABEL: Record<SearchResult["kind"], string> = { token: "Token", creator: "Creator", wallet: "Wallet", transaction: "Transaction" };

export function useSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const s = q.trim();
    if (!s) {
      setResults([]);
      setError(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(s)}`, { signal: ctl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error?.message ?? "Search failed");
        setResults(j.data);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);
  return { q, setQ, results, loading, error };
}

export function ResultList({ results, active, onPick, id }: { results: SearchResult[]; active: number; onPick: (r: SearchResult) => void; id: string }) {
  return (
    <ul id={id} role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
      {results.map((r, i) => (
        <li key={`${r.kind}-${"address" in r ? r.address : r.hash}`} role="option" aria-selected={i === active}>
          <button
            type="button"
            onClick={() => onPick(r)}
            className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors", i === active ? "bg-surface-3" : "hover:bg-surface-2")}
          >
            <span className="label w-24 shrink-0">{KIND_LABEL[r.kind]}</span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {r.kind === "token" ? (
                <>
                  <span className="font-medium">{r.symbol ? `$${r.symbol}` : "Unnamed contract"}</span> <span className="text-fg-2">{r.name}</span>
                </>
              ) : r.kind === "creator" ? (
                <span className="text-fg-2">
                  {r.launchCount} launch{r.launchCount === 1 ? "" : "es"} observed
                </span>
              ) : r.kind === "transaction" ? (
                <span className="text-fg-2">{r.token ? "Related to indexed token" : "Open in explorer"}</span>
              ) : (
                <span className="text-fg-2">No launches observed</span>
              )}
            </span>
            <span className="font-mono text-xs text-fg-2">{shortAddress("address" in r ? r.address : r.hash, 4, 4)}</span>
            {i === active ? <CornerDownLeft className="size-3.5 text-fg-2" /> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { q, setQ, results, loading, error } = useSearch();
  const [active, setActive] = useState(0);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("vp:open-search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("vp:open-search", onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 10);
    else setQ("");
  }, [open, setQ]);
  useEffect(() => setActive(0), [results]);

  const pick = useCallback(
    (r: SearchResult) => {
      setOpen(false);
      if (r.href.startsWith("http")) window.open(r.href, "_blank", "noopener");
      else router.push(r.href);
    },
    [router],
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Search tokens, wallets and transactions"
            className="w-full max-w-xl overflow-hidden rounded-[20px] border border-accent/20 bg-surface shadow-[0_30px_80px_-20px_#a65c3633]"
            initial={{ opacity: 0, y: -6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === "Enter" && results[active]) pick(results[active]);
            }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              {loading ? <Loader2 className="size-4 animate-spin text-fg-2" /> : <Search className="size-4 text-fg-2" />}
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Token address, $SYMBOL, creator wallet or tx hash"
                aria-label="Search"
                aria-controls={listId}
                aria-activedescendant={undefined}
                className="h-12 w-full bg-transparent text-[15px] placeholder:text-muted focus:outline-none"
                spellCheck={false}
                autoComplete="off"
              />
              <kbd className="rounded border border-line px-1.5 font-mono text-[10px] text-fg-2">ESC</kbd>
            </div>
            {error ? <p className="px-4 py-3 text-sm text-attention">{error}</p> : null}
            {results.length ? (
              <ResultList id={listId} results={results} active={active} onPick={pick} />
            ) : q.trim() && !loading && !error ? (
              <p className="px-4 py-6 text-sm text-fg-2">No matches. Try a full 0x address.</p>
            ) : null}
            {!q.trim() ? (
              <div className="grid grid-cols-2 gap-2 px-4 py-4 text-xs text-fg-2 sm:grid-cols-4">
                {["0x… token", "$SYMBOL", "0x… creator", "0x… tx hash"].map((h) => (
                  <span key={h} className="rounded-full border border-line px-3 py-1.5 text-center font-mono">
                    {h}
                  </span>
                ))}
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function SearchTrigger({ className, large = false, compact = false }: { className?: string; large?: boolean; compact?: boolean }) {
  if (compact)
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("vp:open-search"))}
        aria-label="Search token, wallet or transaction"
        className={cn("flex size-10 items-center justify-center rounded-full border border-line-strong text-fg-2 transition-colors hover:text-fg", className)}
      >
        <Search className="size-4" />
      </button>
    );
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("vp:open-search"))}
      className={cn(
        "group flex items-center gap-3 rounded-full border text-left text-fg-2 transition-colors hover:text-fg",
        large
          ? "h-14 w-full border-accent/25 bg-surface/80 px-6 text-[15px] shadow-[0_0_40px_-12px_#d57c3f33] hover:border-accent/50"
          : "h-10 border-line-strong bg-surface/60 px-4 text-sm hover:border-line-strong",
        className,
      )}
      aria-label="Search token, wallet or transaction"
    >
      <Search className={large ? "size-4.5 text-accent" : "size-3.5"} />
      <span className="flex-1 truncate">{large ? "Search a token, wallet or transaction" : "Search"}</span>
      <kbd className="hidden rounded-full border border-line-strong px-2 py-0.5 font-mono text-[10px] sm:inline">⌘K</kbd>
    </button>
  );
}

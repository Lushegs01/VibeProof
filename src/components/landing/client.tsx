"use client";

import { Minus, Plus, Search } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

export function OpenSearchButton({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("vp:open-search"))} className={className}>
      {children}
    </button>
  );
}

export type Faq = { q: string; a: string };

/** Searchable accordion. One item open at a time; native buttons with aria-expanded. */
export function FaqList({ items }: { items: Faq[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(0);
  const base = useId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.map((it, i) => ({ ...it, i })).filter((it) => !q || `${it.q} ${it.a}`.toLowerCase().includes(q));
  }, [items, query]);
  return (
    <div>
      <label className="relative mx-auto block max-w-xs">
        <span className="sr-only">Search questions</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-2" aria-hidden />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="input !pl-11" />
      </label>
      <ul className="mt-12">
        {shown.map(({ q, a, i }) => {
          const isOpen = open === i;
          return (
            <li key={q}>
              <h3 className="font-sans tracking-normal">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`${base}-${i}`}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  className="flex w-full items-center justify-between gap-6 py-7 text-left text-lg font-medium text-fg md:text-xl"
                >
                  {q}
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-full transition-colors ${isOpen ? "bg-fg text-bg" : "bg-fg text-bg"}`} aria-hidden>
                    {isOpen ? <Minus className="size-4" /> : <Plus className="size-4" />}
                  </span>
                </button>
              </h3>
              <div id={`${base}-${i}`} hidden={!isOpen} className="max-w-3xl pb-7 text-[15px] leading-relaxed text-fg-2 md:text-base">
                {a}
              </div>
              <div className="hairline" />
            </li>
          );
        })}
        {!shown.length ? <li className="py-8 text-center text-sm text-fg-2">No matching questions.</li> : null}
      </ul>
    </div>
  );
}

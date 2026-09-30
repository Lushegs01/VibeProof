"use client";

import { Info, X, ArrowUpRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Evidence } from "@/lib/verification/types";
import { formatUtc } from "@/lib/util/format";

/** "Why am I seeing this?" — the data provenance panel. Uses the native <dialog> for focus trapping and Esc handling. */
export function EvidenceButton({ metric, value, evidence, note, children }: { metric: string; value: ReactNode; evidence: Evidence; note?: string; children?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open, mounted]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded p-1 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
        aria-label={`Why am I seeing this? Provenance for ${metric}`}
        title="Why am I seeing this?"
      >
        {children ?? <Info className="size-3.5" />}
      </button>
      {mounted && open
        ? createPortal(
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && setOpen(false)}
        className="m-auto w-[min(520px,calc(100vw-32px))] font-sans normal-case tracking-normal rounded-md border border-line-strong bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-[2px] open:animate-[fadeIn_.16s_ease-out]"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="label !text-fg">
            Data provenance
          </h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-fg-2 hover:bg-surface-3 hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-3 px-5 py-5 text-sm">
          <Item k="Metric">{metric}</Item>
          <Item k="Value">
            <span className="font-mono">{value}</span>
          </Item>
          <Item k="Observed">
            <span className="font-mono">{formatUtc(evidence.observedAt)}</span>
          </Item>
          <Item k="Source">{evidence.source}</Item>
          {evidence.block ? (
            <Item k="Block">
              <a className="font-mono underline decoration-line-strong underline-offset-4" href={`https://explorer.testnet.chain.robinhood.com/block/${evidence.block}`} target="_blank" rel="noopener noreferrer">
                #{Number(evidence.block).toLocaleString("en-US")}
              </a>
            </Item>
          ) : null}
          {evidence.contract ? (
            <Item k="Contract">
              <span className="font-mono text-xs break-all">{evidence.contract}</span>
            </Item>
          ) : null}
          <Item k="Method">{evidence.method}</Item>
          {evidence.detail ? <Item k="Detail">{evidence.detail}</Item> : null}
          {note ? <Item k="Note">{note}</Item> : null}
          {evidence.url ? (
            <Item k="Link">
              <a className="inline-flex items-center gap-1 break-all underline decoration-line-strong underline-offset-4" href={evidence.url} target="_blank" rel="noopener noreferrer nofollow">
                {evidence.url} <ArrowUpRight className="size-3" />
              </a>
            </Item>
          ) : null}
        </dl>
        <p className="border-t border-line px-5 py-3 text-xs text-fg-2">VibeProof reports evidence, not judgements. Every value above can be reproduced from the listed source.</p>
      </dialog>,
            document.body,
          )
        : null}
    </>
  );
}

function Item({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="label pt-0.5">{k}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </>
  );
}

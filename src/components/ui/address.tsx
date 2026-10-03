"use client";

import { Check, Copy, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { shortAddress } from "@/lib/util/address";
import { cn } from "@/lib/util/cn";
import { activeNetwork, getNetwork } from "@/lib/chain/networks";

export function Address({ value, href, explorer = "address", short = true, className, chain }: { value: string; href?: string; explorer?: "address" | "tx" | "token" | false; short?: boolean; className?: string; chain?: string }) {
  const EXPLORER = (getNetwork(chain) ?? activeNetwork()).explorerUrl;
  const [copied, setCopied] = useState(false);
  const text = short ? shortAddress(value, value.length > 50 ? 6 : 4, value.length > 50 ? 6 : 4) : value;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 font-mono text-[13px] tabular", className)}>
      {href ? (
        <Link href={href} className="truncate text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg-2" title={value}>
          {text}
        </Link>
      ) : (
        <span className="truncate" title={value}>
          {text}
        </span>
      )}
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : `Copy ${value}`} className="rounded p-1 text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg">
        {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
      </button>
      {explorer ? (
        <a href={`${EXPLORER}/${explorer}/${value}`} target="_blank" rel="noopener noreferrer" aria-label="View on explorer" className="rounded p-1 text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg">
          <ArrowUpRight className="size-3.5" />
        </a>
      ) : null}
    </span>
  );
}

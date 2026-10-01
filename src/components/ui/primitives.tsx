import type { ReactNode } from "react";
import { cn } from "@/lib/util/cn";

export function Section({ id, title, kicker, action, children, className }: { id?: string; title: string; kicker?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("py-10 md:py-14", className)}>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id={id ? `${id}-title` : undefined} className="text-gradient text-2xl font-medium md:text-[2rem]">
            {title}
          </h2>
          {kicker ? <span className="text-xs text-fg-2">{kicker}</span> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("glass", className)}>{children}</div>;
}

export function Row({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-12 items-center justify-between gap-4 border-b border-line/70 py-3 last:border-b-0", className)}>
      <div className="min-w-0 text-sm text-fg-2">
        {label}
        {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2 text-right">{children}</div>
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[13px] tabular", className)}>{children}</span>;
}

export function Pill({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "accent" | "observed" | "claimed" | "attention" | "muted"; className?: string }) {
  const tones = {
    default: "border-line-strong text-fg",
    accent: "border-accent/40 text-accent bg-accent-dim",
    observed: "border-observed/25 text-observed bg-observed/5",
    claimed: "border-claimed/25 text-claimed bg-claimed/5",
    attention: "border-attention/25 text-attention bg-attention/5",
    muted: "border-line text-fg-2",
  };
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function DemoBanner() {
  return (
    <div role="note" className="border-b border-claimed/20 bg-claimed/10 px-4 py-2 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-claimed">
      Demo data · deterministic fixtures for development · not Robinhood Chain data
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

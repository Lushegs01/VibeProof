import type { ReactNode } from "react";
import { cn } from "@/lib/util/cn";

export function Section({ id, title, kicker, action, children, className }: { id?: string; title: string; kicker?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("border-t border-line py-8 md:py-10", className)}>
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 id={id ? `${id}-title` : undefined} className="label !text-fg">
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
  return <div className={cn("rounded-md border border-line bg-surface", className)}>{children}</div>;
}

export function Row({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-11 items-center justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0", className)}>
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
    accent: "border-accent/30 text-accent bg-accent-dim",
    observed: "border-observed/25 text-observed bg-observed/5",
    claimed: "border-claimed/25 text-claimed bg-claimed/5",
    attention: "border-attention/25 text-attention bg-attention/5",
    muted: "border-line text-fg-2",
  };
  return <span className={cn("inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function DemoBanner() {
  return (
    <div role="note" className="border-b border-claimed/20 bg-claimed/5 px-4 py-2 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-claimed">
      Demo data · deterministic fixtures for development · not Robinhood Chain data
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

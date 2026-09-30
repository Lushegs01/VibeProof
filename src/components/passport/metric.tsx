import type { ReactNode } from "react";
import type { Observed } from "@/lib/verification/types";
import { EvidenceButton } from "@/components/ui/evidence";
import { cn } from "@/lib/util/cn";

/** Renders an Observed<T>. `unavailable` is shown explicitly, never as 0 or "—". */
export function Metric({ label, obs, format = (v) => String(v), size = "md", className }: { label: string; obs: Observed<unknown>; format?: (v: never) => ReactNode; size?: "md" | "lg"; className?: string }) {
  const unavailable = obs.state === "unavailable" || obs.value === null;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1">
        <span className="label">{label}</span>
        <EvidenceButton metric={label} value={unavailable ? "Unavailable" : format(obs.value as never)} evidence={obs.evidence} note={obs.error} />
      </div>
      {unavailable ? (
        <div className="mt-1">
          <div className={cn("font-mono text-fg-2", size === "lg" ? "text-lg" : "text-base")}>Unavailable</div>
          {obs.error ? <div className="mt-0.5 text-xs leading-snug text-muted">{obs.error}</div> : null}
        </div>
      ) : (
        <div className={cn("mt-1 font-mono tabular text-fg", size === "lg" ? "text-2xl md:text-[28px]" : "text-lg")}>{format(obs.value as never)}</div>
      )}
    </div>
  );
}

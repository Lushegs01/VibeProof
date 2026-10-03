import { Pill } from "./primitives";

/** Launch status from observed curve events only. "unknown" is shown as such, never as bonding. */
export function LaunchStatus({ status }: { status: string | null | undefined }) {
  if (status === "graduated") return <Pill tone="observed">Graduated</Pill>;
  if (status === "curve_completed") return <Pill tone="accent">Curve complete</Pill>;
  if (status === "bonding") return <Pill tone="muted">Bonding</Pill>;
  return (
    <Pill tone="muted" className="border-dashed">
      Status unknown
    </Pill>
  );
}

/** Coverage of a token's indexed history (see CoverageInfo). */
export function HistoryPending({ complete }: { complete: boolean }) {
  return complete ? null : <span className="text-fg-2" title="This token's complete history is not indexed yet, so the value is unavailable (not zero).">History pending</span>;
}

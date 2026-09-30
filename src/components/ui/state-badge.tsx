import type { VerificationState } from "@/lib/verification/types";
import { STATE_DESCRIPTION, STATE_LABEL } from "@/lib/verification/types";
import { Pill } from "./primitives";

const tone: Record<VerificationState, "accent" | "observed" | "claimed" | "muted"> = {
  verified: "accent",
  observed: "observed",
  creator_claimed: "claimed",
  not_found: "muted",
  unavailable: "muted",
};

export function StateBadge({ state }: { state: VerificationState }) {
  return (
    <Pill tone={tone[state]} className={state === "unavailable" ? "border-dashed" : undefined}>
      <span aria-hidden className={state === "verified" ? "size-1.5 rounded-full bg-accent" : state === "observed" ? "size-1.5 rounded-full bg-observed" : state === "creator_claimed" ? "size-1.5 rounded-full bg-claimed" : "size-1.5 rounded-full border border-fg-2"} />
      <span title={STATE_DESCRIPTION[state]}>{STATE_LABEL[state]}</span>
    </Pill>
  );
}

/** Contract capability status. Deliberately neutral: DETECTED is not "bad", NOT DETECTED is not "safe". */
export function CheckStatus({ status }: { status: "detected" | "not_detected" | "unknown" }) {
  if (status === "detected") return <span className="font-mono text-[12px] tracking-wider text-fg">DETECTED</span>;
  if (status === "not_detected") return <span className="font-mono text-[12px] tracking-wider text-fg-2">NOT DETECTED</span>;
  return <span className="font-mono text-[12px] tracking-wider text-muted">UNKNOWN</span>;
}

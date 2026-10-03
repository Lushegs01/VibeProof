/**
 * Every claim VibeProof shows carries one of these states.
 * `unavailable` must NEVER be rendered as zero, "no", or any negative.
 */
export type VerificationState = "verified" | "observed" | "creator_claimed" | "not_found" | "unavailable";

/** The epistemic class of a statement (spec §49). */
export type ClaimKind = "fact" | "observation" | "creator_claim" | "inference";

export type Evidence = {
  /** Human-readable data source, e.g. "Robinhood Chain Testnet RPC", "Blockscout", "GitHub API". */
  source: string;
  /** How the value was derived. */
  method: string;
  observedAt: string;
  block?: string;
  contract?: string;
  url?: string;
  detail?: string;
  /** Network the evidence refers to (for explorer links); defaults to the active network. */
  network?: string;
};

export type Observed<T> = {
  value: T | null;
  state: VerificationState;
  evidence: Evidence;
  /** Why value is null when state is `unavailable`. */
  error?: string;
};

export function unavailable<T>(source: string, method: string, error: string): Observed<T> {
  return { value: null, state: "unavailable", error, evidence: { source, method, observedAt: new Date().toISOString() } };
}

export const STATE_LABEL: Record<VerificationState, string> = {
  verified: "Verified",
  observed: "Observed",
  creator_claimed: "Creator claimed",
  not_found: "Not found",
  unavailable: "Unavailable",
};

export const STATE_DESCRIPTION: Record<VerificationState, string> = {
  verified: "Independently supported by bytecode, explorer source, or a cryptographic check.",
  observed: "Measured directly by VibeProof at the time shown.",
  creator_claimed: "Supplied by the creator. VibeProof has not independently confirmed it.",
  not_found: "The check completed, and no evidence was found.",
  unavailable: "The check could not be performed. This is not a negative result.",
};

import type { UrlCheckResult } from "./checks";
/** Interpret historical rows honestly, including pre-challenge generic verified labels. */
export function freshCheck(check: UrlCheckResult, now = Date.now()): UrlCheckResult {
  const checked = Date.parse(check.evidence.observedAt);
  const expiresAt = check.expiresAt ?? new Date((Number.isFinite(checked) ? checked : 0) + 6 * 3600_000).toISOString();
  if (!Number.isFinite(checked) || Date.parse(expiresAt) <= now)
    return { ...check, expiresAt, state: "unavailable", assurance: "expired", summary: `Expired observation: ${check.summary}` };
  return {
    ...check,
    expiresAt,
    state: check.state === "verified" ? "observed" : check.state,
    assurance:
      check.state === "creator_claimed"
        ? "creator_claimed"
        : check.state === "unavailable"
          ? "unavailable"
          : check.state === "not_found"
            ? "failed"
            : "reachability_observed",
  };
}

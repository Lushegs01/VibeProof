import { expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { challengeMatches, controlState, controlTarget } from "@/lib/proof/challenges";
import { freshCheck } from "@/lib/proof/freshness";
it("binds publication to exact unpredictable challenge bytes", () => {
  const hash = keccak256(toBytes("vibeproof-control-v1:unpredictable-secret"));
  expect(challengeMatches("vibeproof-control-v1:unpredictable-secret\n", hash)).toBe(true);
  expect(challengeMatches("contract: 0x123", hash)).toBe(false);
  expect(challengeMatches("other-project-challenge", hash)).toBe(false);
});
it("normalizes scope and blocks malicious targets", () => {
  expect(controlTarget("website", "https://example.com/a?q=1")).toBe("https://example.com");
  expect(() => controlTarget("website", "https://127.0.0.1")).toThrow();
  expect(() => controlTarget("github", "https://github.com.evil.org/o/r")).toThrow();
});
it("expires control evidence without a background worker", () => {
  expect(controlState({ status: "verified", validUntil: new Date(100) }, new Date(99))).toBe("control_verified");
  expect(controlState({ status: "verified", validUntil: new Date(100) }, new Date(100))).toBe("expired");
  const check = {
    type: "website" as const,
    url: "https://example.com",
    state: "verified" as const,
    summary: "Address mentioned",
    facts: {},
    evidence: { source: "HTTP", method: "GET", observedAt: new Date(0).toISOString() },
  };
  expect(freshCheck(check, 100).state).toBe("observed");
  expect(freshCheck(check, 7 * 3600_000).assurance).toBe("expired");
});

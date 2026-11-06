import { expect, it } from "vitest";
import { transitionAlert } from "@/lib/services/alert-service";
it("sustains, deduplicates, reminds and recovers alert conditions", () => {
  const policy = { sustainMs: 100, cooldownMs: 1000, severity: "critical" as const };
  const first = transitionAlert("db", null, true, 0, policy);
  expect(first.event).toBeNull();
  const fire = transitionAlert("db", first.state, true, 100, policy);
  expect(fire.event?.kind).toBe("firing");
  expect(transitionAlert("db", fire.state, true, 500, policy).event).toBeNull();
  expect(transitionAlert("db", fire.state, true, 1100, policy).event?.kind).toBe("firing");
  const recovery = transitionAlert("db", fire.state, false, 600, policy);
  expect(recovery.event?.kind).toBe("recovered");
  expect(transitionAlert("db", recovery.state, false, 700, policy).event).toBeNull();
  expect(transitionAlert("db", first.state, false, 50, policy).state.since).toBeNull();
});

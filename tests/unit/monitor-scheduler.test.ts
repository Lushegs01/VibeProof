import { expect, it } from "vitest";
// @ts-expect-error plain JS operational CLI has no declaration file
import { triggerMonitor } from "../../scripts/trigger-monitor.mjs";
const env = { VIBEPROOF_URL: "https://app.example", CRON_SECRET: "local-monitor-secret-fixture-only", VIBEPROOF_ALLOWED_HOSTS: "app.example" };
it("calls only the allowlisted monitor, validates the receipt and classifies failed delivery", async () => {
  const checkedAt = new Date().toISOString();
  expect(
    await triggerMonitor(env, async (url: URL, options: RequestInit) => {
      expect(url.href).toBe("https://app.example/api/cron/monitor");
      expect(options.redirect).toBe("error");
      return Response.json({ status: "ok", monitoring: "ok", checkedAt });
    }),
  ).toEqual({ status: "ok", monitoring: "ok", checkedAt });
  await expect(triggerMonitor(env, async () => Response.json({ status: "ok", monitoring: "degraded", checkedAt }))).rejects.toMatchObject({
    kind: "execution",
  });
  await expect(triggerMonitor(env, async () => new Response("", { status: 401 }))).rejects.toMatchObject({ kind: "authentication" });
  await expect(triggerMonitor(env, async () => new Response("x".repeat(131073)))).rejects.toMatchObject({ kind: "response" });
  await expect(triggerMonitor({ ...env, VIBEPROOF_ALLOWED_HOSTS: "different.example" })).rejects.toMatchObject({ kind: "configuration" });
});

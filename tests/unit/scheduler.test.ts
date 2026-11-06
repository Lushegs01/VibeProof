import { describe, expect, it } from "vitest";
// The scheduler runs with plain Node, before installing application dependencies.
// @ts-expect-error plain JS command has no declaration file
import { schedulerConfig, triggerIndexer } from "../../scripts/trigger-indexer.mjs";
const env = { VIBEPROOF_URL: "https://app.example.com", CRON_SECRET: "a".repeat(32), VIBEPROOF_ALLOWED_HOSTS: "app.example.com" };
describe("scheduler", () => {
  it.each([
    { ...env, CRON_SECRET: "" },
    { ...env, VIBEPROOF_URL: "http://app.example.com" },
    { ...env, VIBEPROOF_URL: "https://app.example.com.evil.org" },
    { ...env, VIBEPROOF_URL: "https://app.example.com/?secret=x" },
    { ...env, VIBEPROOF_ALLOWED_HOSTS: "" },
  ])("refuses invalid configuration without leaking credentials", (bad) => {
    expect(() => schedulerConfig(bad)).toThrow();
  });
  it("classifies auth, transport, timeout and malformed JSON failures", async () => {
    await expect(triggerIndexer(env, async () => new Response("", { status: 401 }))).rejects.toMatchObject({ kind: "authentication" });
    await expect(
      triggerIndexer(env, async () => {
        throw new DOMException("Timeout", "TimeoutError");
      }),
    ).rejects.toMatchObject({ kind: "timeout" });
    await expect(triggerIndexer(env, async () => new Response("not json"))).rejects.toMatchObject({ kind: "response" });
    await expect(triggerIndexer(env, async () => new Response("", { status: 503 }))).rejects.toMatchObject({ kind: "execution" });
  });
  it("accepts a concurrency lock skip but rejects incorrectly skipped work", async () => {
    expect(await triggerIndexer(env, async () => Response.json({ status: "skipped", reason: "another indexer run holds the lock" }))).toEqual({
      status: "skipped",
      reason: "concurrency_lock",
    });
    await expect(triggerIndexer(env, async () => Response.json({ status: "skipped", reason: "no database" }))).rejects.toMatchObject({ kind: "execution" });
  });
  it("validates and reports a real zero-work result", async () => {
    const n = { status: "ok", chainId: 46630, head: "100", activityThrough: "100", lag: "0", madeProgress: false, lastSuccessfulAt: new Date().toISOString() };
    expect((await triggerIndexer(env, async () => Response.json({ status: "success", networks: [n] }))).networks[0].madeProgress).toBe(false);
  });
});

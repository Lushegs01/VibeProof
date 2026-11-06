import { afterEach, expect, it, vi } from "vitest";
import { encryptWebhookSecret, decryptWebhookSecret, webhookSignature, validWebhookSignature, webhookRetrySeconds } from "@/lib/developer/webhooks";
import { effectivePlan, PLANS, TestBillingAdapter } from "@/lib/billing/plans";
afterEach(() => vi.unstubAllEnvs());
it("authenticates exact body, ID and timestamp and rejects replay outside the window", () => {
  const sig = webhookSignature("secret", "delivery-1", 1000, '{"event":1}');
  expect(validWebhookSignature("secret", "delivery-1", 1000, '{"event":1}', sig, 1100)).toBe(true);
  expect(validWebhookSignature("secret", "delivery-2", 1000, '{"event":1}', sig, 1100)).toBe(false);
  expect(validWebhookSignature("secret", "delivery-1", 1000, '{"event":2}', sig, 1100)).toBe(false);
  expect(validWebhookSignature("secret", "delivery-1", 1000, '{"event":1}', sig, 1400)).toBe(false);
});
it("encrypts signing material and rejects ciphertext tampering", () => {
  vi.stubEnv("WEBHOOK_ENCRYPTION_KEY", "a".repeat(64));
  const encrypted = encryptWebhookSecret("signing secret");
  expect(encrypted).not.toContain("signing secret");
  expect(decryptWebhookSecret(encrypted)).toBe("signing secret");
  const bad = Buffer.from(encrypted, "base64");
  bad[15] ^= 1;
  expect(() => decryptWebhookSecret(bad.toString("base64"))).toThrow();
  expect(webhookRetrySeconds(1)).toBe(30);
  expect(webhookRetrySeconds(30)).toBe(86400);
});
it("grants only capacity to active subscriptions, never truth", async () => {
  expect(effectivePlan("developer", "past_due")).toBe("free");
  expect(effectivePlan("developer", "active")).toBe("developer");
  expect(effectivePlan("unknown", "active")).toBe("free");
  expect(Object.keys(PLANS.free)).not.toContain("verified");
  expect((await new TestBillingAdapter().checkout("wallet", "developer")).mode).toBe("test");
});

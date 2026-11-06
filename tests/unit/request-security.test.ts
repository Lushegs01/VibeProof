import { afterEach, expect, it, vi } from "vitest";
import { sameOriginRequest } from "@/lib/auth/request";
import { clientIp, rateLimit } from "@/lib/cache/ratelimit";
import { createSessionToken, readSessionToken } from "@/lib/auth/session";
afterEach(() => vi.unstubAllEnvs());
it("binds mutations to the configured origin rather than forwarded headers", () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  const request = (origin: string) =>
    new Request("https://app.example.com/api/proofs", { method: "POST", headers: { origin, "x-forwarded-host": "evil.example" } });
  expect(sameOriginRequest(request("https://app.example.com"))).toBe(true);
  expect(sameOriginRequest(request("https://evil.example"))).toBe(false);
  expect(sameOriginRequest(new Request("https://app.example.com"))).toBe(false);
});
it("ignores spoofable client IP headers unless ingress trust is explicitly configured", () => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("TRUST_PROXY", "");
  const headers = new Headers({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "8.8.8.8" });
  expect(clientIp(headers)).toBe("unknown");
  vi.stubEnv("TRUST_PROXY", "true");
  expect(clientIp(new Headers({ "x-forwarded-for": "spoofed, 1.1.1.1" }))).toBe("1.1.1.1");
});
it("fails production limits closed when the shared store is unavailable", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("REDIS_URL", "");
  vi.stubEnv("KV_URL", "");
  expect((await rateLimit("unavailable-store", 1, 60)).ok).toBe(false);
});
it("rejects appended token segments and switches of network context", () => {
  const wallet = "0xe794217880011f9cA6961340eD5c16EC9559Fea0";
  const token = createSessionToken(wallet);
  expect(readSessionToken(token + ".extra")).toBeNull();
  vi.stubEnv("NEXT_PUBLIC_VIBEPROOF_NETWORK", "robinhood-mainnet");
  expect(readSessionToken(token)).toBeNull();
});

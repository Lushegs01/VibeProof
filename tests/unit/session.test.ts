import { describe, expect, it } from "vitest";
import { createSessionToken, readSessionToken } from "@/lib/auth/session";

const A = "0xe794217880011f9cA6961340eD5c16EC9559Fea0";

describe("session tokens", () => {
  it("round-trips", () => {
    expect(readSessionToken(createSessionToken(A))).toBe(A);
  });
  it("rejects tampered payloads", () => {
    const t = createSessionToken(A);
    const [p, s] = t.split(".");
    const forged = Buffer.from(`0x${"1".repeat(40)}|9999999999`).toString("base64url");
    expect(readSessionToken(`${forged}.${s}`)).toBeNull();
    expect(readSessionToken(`${p}.${s.slice(0, -2)}xx`)).toBeNull();
    expect(readSessionToken("garbage")).toBeNull();
    expect(readSessionToken(null)).toBeNull();
  });
  it("expires after 24h", () => {
    const t = createSessionToken(A, Date.now() - 25 * 3600_000);
    expect(readSessionToken(t)).toBeNull();
  });
});

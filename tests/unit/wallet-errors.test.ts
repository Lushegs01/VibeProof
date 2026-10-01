import { describe, expect, it } from "vitest";
import { walletErrorMessage } from "@/app/(site)/submit/wallet";

describe("wallet error messages", () => {
  it("explains a missing browser wallet instead of 'Provider not found'", () => {
    const m = walletErrorMessage(Object.assign(new Error("Provider not found."), { name: "ProviderNotFoundError" }));
    expect(m).toMatch(/No browser wallet/);
    expect(m).not.toMatch(/Provider not found/);
  });
  it("maps user rejection and pending requests", () => {
    expect(walletErrorMessage({ code: 4001, message: "User rejected the request." })).toBe("The request was rejected in your wallet.");
    expect(walletErrorMessage({ code: -32002, message: "Request already pending" })).toMatch(/pending request/);
  });
  it("falls back to the first line of other errors", () => {
    expect(walletErrorMessage(new Error("Chain mismatch\nDetails: …"))).toBe("Chain mismatch");
    expect(walletErrorMessage(null)).toBe("The wallet could not connect.");
  });
});

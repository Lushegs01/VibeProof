import { afterAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

/** SIWE end-to-end with a throwaway key generated in-process (never persisted). Uses the test DB for nonces. */
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@localhost:5432/vibeproof_test";

const { issueNonce } = await import("@/lib/auth/session");
const { verifySiwe } = await import("@/lib/auth/siwe");
const { getSql } = await import("@/lib/db/client");

const account = privateKeyToAccount(generatePrivateKey());
const msg = (nonce: string, over: Partial<Parameters<typeof createSiweMessage>[0]> = {}) =>
  createSiweMessage({ domain: "vibeproof.test", address: account.address, uri: "https://vibeproof.test", version: "1", chainId: 46630, nonce, issuedAt: new Date(), expirationTime: new Date(Date.now() + 600_000), ...over });

afterAll(async () => {
  await getSql()?.end();
});

describe.runIf(process.env.SKIP_DB_TESTS !== "1")("Sign-In with Ethereum", () => {
  it("accepts a valid signature once, then rejects the replay", async () => {
    const message = msg(await issueNonce());
    const signature = await account.signMessage({ message });
    expect(await verifySiwe(message, signature, "vibeproof.test")).toEqual({ ok: true, address: account.address });
    expect((await verifySiwe(message, signature, "vibeproof.test")).ok).toBe(false);
  });
  it("rejects a different domain (phishing relay)", async () => {
    const message = msg(await issueNonce());
    const r = await verifySiwe(message, await account.signMessage({ message }), "evil.test");
    expect(r.ok).toBe(false);
  });
  it("rejects the wrong chain", async () => {
    const message = msg(await issueNonce(), { chainId: 1 });
    expect((await verifySiwe(message, await account.signMessage({ message }), "vibeproof.test")).ok).toBe(false);
  });
  it("rejects a signature from another key without burning the nonce", async () => {
    const nonce = await issueNonce();
    const message = msg(nonce);
    const other = privateKeyToAccount(generatePrivateKey());
    expect((await verifySiwe(message, await other.signMessage({ message }), "vibeproof.test")).ok).toBe(false);
    // Nonce is still usable by the rightful signer.
    expect((await verifySiwe(message, await account.signMessage({ message }), "vibeproof.test")).ok).toBe(true);
  });
  it("rejects unknown nonces and expired messages", async () => {
    const m1 = msg("0".repeat(32));
    expect((await verifySiwe(m1, await account.signMessage({ message: m1 }), "vibeproof.test")).ok).toBe(false);
    const m2 = msg(await issueNonce(), { expirationTime: new Date(Date.now() - 1000), issuedAt: new Date(Date.now() - 60_000) });
    expect((await verifySiwe(m2, await account.signMessage({ message: m2 }), "vibeproof.test")).ok).toBe(false);
  });
});

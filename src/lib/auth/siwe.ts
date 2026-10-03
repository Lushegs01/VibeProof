import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { createPublicClient, getAddress, http, verifyMessage, type Address, type Hex } from "viem";
import { getChainConfig } from "../chain/chains";
import { activeNetwork } from "../chain/networks";
import { consumeNonce } from "./session";

export type SiweVerifyResult = { ok: true; address: Address } | { ok: false; reason: string };

/**
 * Verify a Sign-In with Ethereum (EIP-4361) message.
 * Checks: well-formed, domain matches this host, chain id, time bounds, signature
 * (EOA via ecrecover; smart-contract wallets via ERC-1271 on Robinhood Chain), and
 * single-use nonce (consumed last so a bad signature can't burn a nonce).
 */
export async function verifySiwe(message: string, signature: Hex, expectedDomain: string, now = new Date()): Promise<SiweVerifyResult> {
  if (message.length > 4096) return { ok: false, reason: "Message too long" };
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !parsed.nonce || !parsed.domain) return { ok: false, reason: "Malformed SIWE message" };
  if (parsed.chainId !== activeNetwork().chainId) return { ok: false, reason: "Wrong chain id" };
  if (!validateSiweMessage({ message: parsed, domain: expectedDomain, time: now })) return { ok: false, reason: "Domain, time window or format invalid" };
  const address = getAddress(parsed.address);
  let valid = false;
  try {
    valid = await verifyMessage({ address, message, signature });
  } catch {
    valid = false;
  }
  if (!valid) {
    // ERC-1271 / ERC-6492 smart-account signatures need an onchain call.
    try {
      const cfg = getChainConfig()!;
      const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
      valid = await client.verifyMessage({ address, message, signature });
    } catch {
      valid = false;
    }
  }
  if (!valid) return { ok: false, reason: "Invalid signature" };
  if (!(await consumeNonce(parsed.nonce))) return { ok: false, reason: "Nonce unknown, expired or already used" };
  return { ok: true, address };
}

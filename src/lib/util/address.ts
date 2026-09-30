import { getAddress, isAddress, type Address, type Hash } from "viem";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;

/** Strict: 0x + 40 hex, and checksum must be valid if mixed-case. */
export function parseAddress(input: unknown): Address | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!ADDRESS_RE.test(s)) return null;
  if (!isAddress(s, { strict: true })) return null;
  return getAddress(s);
}

export function isTxHash(input: unknown): input is Hash {
  return typeof input === "string" && TX_RE.test(input.trim());
}

export function shortAddress(a: string, head = 4, tail = 4) {
  if (a.length <= 2 + head + tail) return a;
  return `${a.slice(0, 2 + head)}…${a.slice(-tail)}`;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const DEAD_ADDRESSES = new Set([ZERO_ADDRESS.toLowerCase(), "0x000000000000000000000000000000000000dead"]);

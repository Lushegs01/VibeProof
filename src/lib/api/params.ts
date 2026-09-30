import { parseAddress } from "../util/address";
import { fail } from "./response";
import type { Address } from "viem";
import { isDemoMode } from "../demo/mode";

export type AddrCtx = { params: Promise<{ address: string }> };

export async function addressParam(ctx: AddrCtx): Promise<{ address: Address } | { error: Response }> {
  const { address } = await ctx.params;
  const a = parseAddress(address) ?? parseAddress(address?.toLowerCase());
  if (!a) return { error: fail(400, "invalid_address", "Expected a 0x-prefixed 20-byte address (checksum must be valid if mixed case).") };
  return { address: a };
}

export const baseMeta = (source: string, cached = false) => ({ source: isDemoMode() ? "DEMO DATA" : source, observedAt: new Date().toISOString(), cached, demo: isDemoMode() });

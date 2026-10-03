import { parseAddress } from "../util/address";
import { fail } from "./response";
import type { Address } from "viem";
import { isDemoMode } from "../demo/mode";
import { activeNetworkSlug, isNetworkSlug, NETWORKS, type NetworkSlug } from "../chain/networks";

export type AddrCtx = { params: Promise<{ address: string }> };

export async function addressParam(ctx: AddrCtx): Promise<{ address: Address } | { error: Response }> {
  const { address } = await ctx.params;
  const a = parseAddress(address) ?? parseAddress(address?.toLowerCase());
  if (!a) return { error: fail(400, "invalid_address", "Expected a 0x-prefixed 20-byte address (checksum must be valid if mixed case).") };
  return { address: a };
}

export const baseMeta = (source: string, cached = false) => ({ source: isDemoMode() ? "DEMO DATA" : source, observedAt: new Date().toISOString(), cached, demo: isDemoMode() });

/**
 * `?chain=robinhood-testnet|robinhood-mainnet` (default: the active network). An unknown value
 * is a 400, never a silent fallback to another network's data.
 */
export function networkParam(req: Request): { network: NetworkSlug } | { error: Response } {
  const v = new URL(req.url).searchParams.get("chain");
  if (v === null || v === "") return { network: activeNetworkSlug() };
  if (!isNetworkSlug(v)) return { error: fail(400, "invalid_chain", `Unknown chain "${v.slice(0, 40)}". Supported: ${Object.keys(NETWORKS).join(", ")}.`) };
  return { network: v };
}

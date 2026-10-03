import type { LaunchpadAdapter } from "./types";
import { VibeAdapter } from "./vibe";

/**
 * Launchpad adapters per chain. Adding a launchpad = implement LaunchpadAdapter and list it here;
 * the indexer, schema and services need no changes. A chain with no configured deployments still
 * gets its adapters (they simply report zero deployments, which /api/health surfaces).
 */
const cache = new Map<number, LaunchpadAdapter[]>();

export function launchpadAdapters(chainId: number): LaunchpadAdapter[] {
  let list = cache.get(chainId);
  if (!list) {
    list = [new VibeAdapter(chainId)];
    cache.set(chainId, list);
  }
  return list;
}

/** All protocol-held addresses across a chain's adapters (labels for holder lists, exclusions for counts). */
export function protocolExclusions(chainId: number) {
  return launchpadAdapters(chainId)
    .flatMap((a) => a.protocolExclusions())
    .filter((x, i, arr) => arr.findIndex((y) => y.address === x.address) === i);
}

export function launchpadLabel(chainId: number, launchpad: string | null | undefined) {
  return launchpadAdapters(chainId).find((a) => a.id === launchpad)?.label ?? launchpad ?? "unknown launchpad";
}

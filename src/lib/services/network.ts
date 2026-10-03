import { activeNetworkSlug, getNetwork, NETWORKS, type NetworkInfo, type NetworkSlug } from "../chain/networks";

/**
 * Network for a service call: an explicit (validated) slug, else the active network.
 * Services never fall back to another network's data.
 */
export function serviceNetwork(slug?: string | null): NetworkInfo {
  if (slug === undefined || slug === null || slug === "") return NETWORKS[activeNetworkSlug()];
  const n = getNetwork(slug);
  if (!n) throw new UnknownNetworkError(slug);
  return n;
}

export class UnknownNetworkError extends Error {
  constructor(readonly slug: string) {
    super(`Unknown network "${slug}". Supported: ${Object.keys(NETWORKS).join(", ")}`);
    this.name = "UnknownNetworkError";
  }
}

export type { NetworkSlug };

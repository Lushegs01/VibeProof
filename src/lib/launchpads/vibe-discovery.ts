import { getAddress, isAddress, type Address } from "viem";

/**
 * Discover vibe/vibe deployments from the PUBLICLY SERVED app bundle (no authentication, no
 * private endpoints). Used by `npm run vibe:verify` to detect new or stale factory addresses;
 * never on the indexing hot path, and never trusted without onchain confirmation.
 *
 * The app keeps its deployment table in a module (`domain-shared-*.js` on 2026-10-03) as
 *   v5Graphs:{live:{deployments:{factory:"0x…",…}}}   v6Graphs:{run15:{run:"run15",chainId:46630,deployBlock:…,factory:"0x…",…}}
 */
export type DiscoveredDeployment = {
  key: string;
  version: "v5" | "v6";
  chainId: number | null;
  factory: Address;
  bundleDeployBlock: bigint | null;
  contracts: Record<string, Address>;
  sourceFile: string;
};

export type DiscoveryResult = { appUrl: string; files: number; bytes: number; deployments: DiscoveredDeployment[]; errors: string[] };

const CHUNK = /[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.js/g;

/** Pull `name:"0x…"` pairs out of a minified object literal. */
function addresses(obj: string): Record<string, Address> {
  const out: Record<string, Address> = {};
  for (const m of obj.matchAll(/([A-Za-z0-9_]+):"(0x[0-9a-fA-F]{40})"/g)) if (isAddress(m[2])) out[m[1]] = getAddress(m[2]);
  return out;
}

/** Return the balanced `{…}` starting at `start` (which must point at "{"). */
function balanced(s: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < s.length && i < start + 200_000; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

export function parseBundle(source: string, file: string): DiscoveredDeployment[] {
  const found: DiscoveredDeployment[] = [];
  for (const m of source.matchAll(/v6Graphs:\{/g)) {
    const body = balanced(source, m.index! + "v6Graphs:".length);
    if (!body) continue;
    for (const run of body.matchAll(/([A-Za-z0-9_]+):\{run:"([^"]+)",chainId:(\d+),deployBlock:(\d+),factory:"(0x[0-9a-fA-F]{40})"/g)) {
      const own = balanced(body, run.index! + run[1].length + 1) ?? "";
      const contracts = addresses(own);
      // Quote assets / pool keys are not protocol contracts.
      for (const k of ["factory", "token", "currency0", "currency1", "hooks"]) delete contracts[k];
      found.push({ key: `v6Graphs.${run[1]}`, version: "v6", chainId: Number(run[3]), factory: getAddress(run[5]), bundleDeployBlock: BigInt(run[4]), contracts, sourceFile: file });
    }
  }
  for (const m of source.matchAll(/v5Graphs:\{/g)) {
    const body = balanced(source, m.index! + "v5Graphs:".length);
    if (!body) continue;
    for (const g of body.matchAll(/([A-Za-z0-9_]+):\{deployments:\{/g)) {
      const dep = balanced(body, g.index! + g[0].length - 1) ?? "";
      const contracts = addresses(dep);
      if (!contracts.factory) continue;
      const factory = contracts.factory;
      delete contracts.factory;
      found.push({ key: `v5Graphs.${g[1]}`, version: "v5", chainId: null, factory, bundleDeployBlock: null, contracts, sourceFile: file });
    }
  }
  return found;
}

/** Fetch the app HTML, crawl its JS chunks (bounded), and parse deployment tables. */
export async function discoverVibeDeployments(appUrl = "https://testnet.vibevibe.fun/", opts: { maxFiles?: number; maxBytes?: number; fetchFn?: typeof fetch } = {}): Promise<DiscoveryResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxFiles = opts.maxFiles ?? 400;
  const maxBytes = opts.maxBytes ?? 40 * 1024 * 1024;
  const errors: string[] = [];
  const get = async (url: string) => {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "VibeProof deployment verifier (+https://github.com/Lushegs01/VibeProof)" } });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.text();
  };
  const html = await get(appUrl);
  const base = new URL(appUrl);
  const entry = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => new URL(m[1], base).toString());
  const dir = entry[0] ? entry[0].slice(0, entry[0].lastIndexOf("/") + 1) : new URL("/static-v2/", base).toString();
  const queue = [...entry];
  const seen = new Set<string>();
  const deployments = new Map<string, DiscoveredDeployment>();
  let bytes = 0;
  while (queue.length && seen.size < maxFiles && bytes < maxBytes) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    let src: string;
    try {
      src = await get(url);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      continue;
    }
    bytes += src.length;
    const file = url.slice(url.lastIndexOf("/") + 1);
    for (const d of parseBundle(src, file)) deployments.set(`${d.key}:${d.factory}`, d);
    for (const m of src.matchAll(CHUNK)) {
      const next = dir + m[0];
      if (!seen.has(next)) queue.push(next);
    }
  }
  return { appUrl, files: seen.size, bytes, deployments: [...deployments.values()], errors };
}

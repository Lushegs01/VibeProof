import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import type { LaunchpadDeployment } from "../launchpads/types";

/**
 * vibe/vibe deployments, per chain, with provenance.
 *
 * TESTNET (46630). vibe/vibe publishes no address list. The values below were read from the
 * public app bundle served at https://testnet.vibevibe.fun (`vibevibe.fun` redirects there;
 * module `domain-shared-*.js`, config keys `v6Graphs.run15` and `v5Graphs.live.deployments`)
 * and confirmed onchain on 2026-10-03: bytecode is present, the factory creation transactions
 * succeed, and the factories emit logs whose topic0 matches the bundle's event signatures
 * (see docs/assessment.md §7). None has verified source on Blockscout.
 *
 * MAINNET (4663). No vibe/vibe deployment is known. The bundle carries no mainnet deployment
 * config, none of the testnet factory/protocol addresses has bytecode on mainnet, and a scan of
 * every mainnet block (0–78,940,315) for all three launch-event topics returned zero logs
 * (docs/verification/mainnet-vibe-scan-2026-10-03.json). The list is therefore EMPTY; nothing is
 * guessed. When vibe/vibe deploys there, add it via VIBE_EXTRA_DEPLOYMENTS (below) or here.
 *
 * Re-check with `npm run vibe:verify`, which re-reads the public bundle and the chain.
 */
export type VibeDeployment = LaunchpadDeployment;

const env = (k: string) => {
  const v = typeof process !== "undefined" ? process.env[k]?.trim() : undefined;
  return v ? v : undefined;
};

const BUNDLE = "https://testnet.vibevibe.fun (domain-shared-*.js)";

function overridable(dep: LaunchpadDeployment, factoryVar: string, startVar: string): LaunchpadDeployment {
  const f = env(factoryVar);
  if (!f || f.toLowerCase() === dep.factory.toLowerCase()) return dep;
  if (!isAddress(f)) throw new Error(`${factoryVar} is not a valid address`);
  const start = env(startVar);
  // An overridden factory is no longer the verified one: say so, and don't reuse its start block.
  return {
    ...dep,
    factory: getAddress(f),
    startBlock: start ? BigInt(start) : null,
    provenance: { source: "unknown", references: [`env ${factoryVar}`], verifiedAt: null, sourceVerified: null, notes: "Factory overridden by environment; not verified by VibeProof." },
  };
}

const TESTNET: LaunchpadDeployment[] = [
  overridable(
    {
      id: "v6-run15",
      launchpad: "vibe",
      chainId: 46630,
      version: "v6",
      factory: "0xe794217880011f9cA6961340eD5c16EC9559Fea0",
      // Bundle `deployBlock` is 123,503,237; the factory's own creation tx is in 123,503,472 and the
      // first LaunchCreated is at 126,070,172. Scanning from the bundle value is harmless and safe.
      startBlock: 123_503_237n,
      protocolContracts: {
        zap: "0x2784448c519D01d3aE257C0aac0b7cDAd8AccEB1",
        hook: "0xA5E27E3E54739162fe52C2C48E55B6dd6572e8EC",
        locker: "0x7771E60708060c43C8562c4544fBd5c365e549c0",
        buyback: "0xC58D6B65424eD5Ea6F88AA5f000C0eFE76F6110A",
        pairPolicy: "0x48CFA6c8F3591C6F385652CADf71F310afB2cc84",
        giftLists: "0xb78F181AaBCC62595a1682714894766001d488Be",
        poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
      },
      provenance: {
        source: "public_app_config+onchain",
        references: [`${BUNDLE} v6Graphs.run15`, "factory creation tx 0xcb76652070f9923a0b7a6cea9bac7b0471fadfa862c5ed1f5abbeb7dadb9b76c"],
        verifiedAt: "2026-10-03",
        creationTx: "0xcb76652070f9923a0b7a6cea9bac7b0471fadfa862c5ed1f5abbeb7dadb9b76c",
        creationBlock: 123_503_472n,
        sourceVerified: false,
      },
      enabled: true,
    },
    "VIBE_V6_FACTORY",
    "VIBE_V6_START_BLOCK",
  ),
  overridable(
    {
      id: "v5-live",
      launchpad: "vibe",
      chainId: 46630,
      version: "v5",
      factory: "0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59",
      // Not in the bundle; the factory's creation tx (via the CREATE2 deployer 0x4e59…956C).
      startBlock: 115_025_604n,
      protocolContracts: {
        graduationAdapter: "0xA6a5D4C098dA8f79eae1203A8E42ff9AC7a17F06",
        feeHook: "0x2779651feE12F6fB5A187578De6b63709f85d0Cc",
        liquidityLocker: "0xc0a2DEEbdc40b7083dC9a067F6992F884Fb6074D",
        protocolTreasury: "0x91719A47f855079678b3D5E3af69CDe2b830c5C9",
        poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
      },
      provenance: {
        source: "public_app_config+onchain",
        references: [`${BUNDLE} v5Graphs.live.deployments`, "factory creation tx 0xd71ff4609f19517e3155f918fcbd32959df3b08e3784a2007eecc224c92a5b2a"],
        verifiedAt: "2026-10-03",
        creationTx: "0xd71ff4609f19517e3155f918fcbd32959df3b08e3784a2007eecc224c92a5b2a",
        creationBlock: 115_025_604n,
        sourceVerified: false,
      },
      enabled: true,
    },
    "VIBE_V5_FACTORY",
    "VIBE_V5_START_BLOCK",
  ),
];

/**
 * Extra deployments without a code change (a new Vibe "run", or a mainnet deployment once one
 * exists). JSON array, e.g.
 *   VIBE_EXTRA_DEPLOYMENTS='[{"chainId":4663,"id":"v6-run16","version":"v6","factory":"0x…","startBlock":"123",
 *     "protocolContracts":{"zap":"0x…"},"source":"public_app_config+onchain","references":["…"]}]'
 * Provenance defaults to "unknown": an operator assertion is not independent verification.
 */
const ExtraSchema = z.array(
  z.object({
    chainId: z.number().int().positive(),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
    version: z.enum(["v5", "v6"]),
    factory: z.string().refine((a) => isAddress(a), "invalid address"),
    startBlock: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).nullable().optional(),
    protocolContracts: z.record(z.string(), z.string().refine((a) => isAddress(a), "invalid address")).optional(),
    source: z.enum(["official_documentation", "public_app_config+onchain", "onchain_only", "unknown"]).optional(),
    references: z.array(z.string().max(300)).optional(),
  }),
);

export function parseExtraDeployments(raw: string | undefined): LaunchpadDeployment[] {
  if (!raw) return [];
  const parsed = ExtraSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`VIBE_EXTRA_DEPLOYMENTS is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data.map((d) => ({
    id: d.id,
    launchpad: "vibe",
    chainId: d.chainId,
    version: d.version,
    factory: getAddress(d.factory),
    startBlock: d.startBlock === undefined || d.startBlock === null ? null : BigInt(d.startBlock),
    protocolContracts: Object.fromEntries(Object.entries(d.protocolContracts ?? {}).map(([k, v]) => [k, getAddress(v)])),
    provenance: { source: d.source ?? "unknown", references: d.references ?? ["env VIBE_EXTRA_DEPLOYMENTS"], verifiedAt: null, sourceVerified: null, notes: "Supplied via VIBE_EXTRA_DEPLOYMENTS." },
    enabled: true,
  }));
}

/** All configured vibe/vibe deployments for a chain (empty for chains without a known deployment). */
export function vibeDeployments(chainId: number): LaunchpadDeployment[] {
  const base = chainId === 46630 ? TESTNET : [];
  const extra = parseExtraDeployments(env("VIBE_EXTRA_DEPLOYMENTS")).filter((d) => d.chainId === chainId);
  const all = [...base, ...extra];
  const ids = new Set<string>();
  for (const d of all) {
    if (ids.has(d.id)) throw new Error(`Duplicate vibe/vibe deployment id ${d.id} on chain ${chainId}`);
    ids.add(d.id);
  }
  return all.filter((d) => d.enabled);
}

/** @deprecated testnet list, kept for existing imports. Use vibeDeployments(chainId). */
export const VIBE_DEPLOYMENTS: LaunchpadDeployment[] = TESTNET;

/**
 * Roles the original spec asked for that have NO verified address.
 * Kept as explicit `undefined` so nothing downstream can silently assume one.
 */
export const VIBE_CONTRACTS = {
  testnet: {
    launchpadFactory: TESTNET[0].factory as Address | undefined,
    router: undefined as Address | undefined,
    registry: undefined as Address | undefined,
    feeController: undefined as Address | undefined,
  },
  mainnet: {
    launchpadFactory: undefined as Address | undefined,
    router: undefined as Address | undefined,
    registry: undefined as Address | undefined,
    feeController: undefined as Address | undefined,
  },
};

export function isVibeFactory(address: string, chainId = 46630) {
  const a = address.toLowerCase();
  return vibeDeployments(chainId).find((d) => d.factory.toLowerCase() === a) ?? null;
}

/**
 * Protocol-owned addresses that hold tokens as liquidity/escrow, not as holders, per chain.
 * Excluded from holder counts (along with each token's own curve, the token contract itself and
 * zero/dead). The factory is included: the vibe/vibe app excludes it too.
 */
export function protocolHolderExclusions(chainId: number): { address: string; label: string }[] {
  return vibeDeployments(chainId)
    .flatMap((d) => [{ address: d.factory.toLowerCase(), label: `vibe/vibe ${d.id} factory` }, ...Object.entries(d.protocolContracts).map(([label, address]) => ({ address: address.toLowerCase(), label: `vibe/vibe ${d.id} ${label}` }))])
    .filter((x, i, arr) => arr.findIndex((y) => y.address === x.address) === i);
}

/** @deprecated testnet list, kept for existing imports. */
export const PROTOCOL_HOLDER_EXCLUSIONS = protocolHolderExclusions(46630);

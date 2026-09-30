import type { Address } from "viem";

/**
 * Vibe (vibe/vibe) protocol contracts on Robinhood Chain Testnet.
 *
 * PROVENANCE. Nothing in here is guessed. Every value was:
 *   1. read from the official vibe/vibe application bundle served at
 *      https://testnet.vibevibe.fun (module `domain-shared-*.js`, config keys
 *      `v5Graphs.live.deployments` and `v6Graphs.run15`), AND
 *   2. confirmed onchain on 2026-09-30: eth_getCode returns non-empty bytecode and
 *      the contracts emit logs whose topic0 equals keccak256 of the event
 *      signatures found in the same bundle (see ./abis.ts).
 *
 * NOT yet verified: none of these contracts had verified source on Blockscout at
 * the time of writing, and vibe/vibe has not published a public docs page listing
 * addresses. Treat `verification: "official-app+onchain"` accordingly and re-check
 * whenever the vibe/vibe app ships a new "run". Every value can be overridden by env.
 */
export type VibeDeployment = {
  id: string;
  generation: "v5" | "v6";
  factory: Address;
  /** Block the factory was deployed at (indexer start). */
  deployBlock: bigint | null;
  launchEvent: "TokenLaunched" | "LaunchCreated";
  verification: "official-app+onchain" | "config-only";
  extra: Partial<Record<"zap" | "hook" | "locker" | "buyback" | "poolManager" | "graduationAdapter" | "feeHook" | "liquidityLocker" | "protocolTreasury", Address>>;
};

const env = (k: string) => (typeof process !== "undefined" ? process.env[k] : undefined) as Address | undefined;

export const VIBE_DEPLOYMENTS: VibeDeployment[] = [
  {
    id: "v6-run15",
    generation: "v6",
    factory: env("VIBE_V6_FACTORY") ?? "0xe794217880011f9cA6961340eD5c16EC9559Fea0",
    deployBlock: 123503237n,
    launchEvent: "LaunchCreated",
    verification: "official-app+onchain",
    extra: {
      zap: "0x2784448c519D01d3aE257C0aac0b7cDAd8AccEB1",
      hook: "0xA5E27E3E54739162fe52C2C48E55B6dd6572e8EC",
      locker: "0x7771E60708060c43C8562c4544fBd5c365e549c0",
      buyback: "0xC58D6B65424eD5Ea6F88AA5f000C0eFE76F6110A",
      poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    },
  },
  {
    id: "v5-live",
    generation: "v5",
    factory: env("VIBE_V5_FACTORY") ?? "0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59",
    // Not in the app bundle. Taken from the factory's creation tx on Blockscout
    // (0x40f1…DF59 created in block 115025604, 2026-09-07T18:12:55Z).
    deployBlock: 115025604n,
    launchEvent: "TokenLaunched",
    verification: "official-app+onchain",
    extra: {
      graduationAdapter: "0xA6a5D4C098dA8f79eae1203A8E42ff9AC7a17F06",
      feeHook: "0x2779651feE12F6fB5A187578De6b63709f85d0Cc",
      liquidityLocker: "0xc0a2DEEbdc40b7083dC9a067F6992F884Fb6074D",
      protocolTreasury: "0x91719A47f855079678b3D5E3af69CDe2b830c5C9",
      poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    },
  },
];

/**
 * Roles the original spec asked for that have NO verified address yet.
 * Kept as explicit `undefined` so nothing downstream can silently assume one.
 */
export const VIBE_CONTRACTS = {
  testnet: {
    launchpadFactory: VIBE_DEPLOYMENTS[0].factory as Address | undefined,
    router: undefined as Address | undefined,
    registry: undefined as Address | undefined,
    feeController: undefined as Address | undefined,
  },
};

export function isVibeFactory(address: string) {
  const a = address.toLowerCase();
  return VIBE_DEPLOYMENTS.find((d) => d.factory.toLowerCase() === a) ?? null;
}

/**
 * Protocol-owned addresses that hold tokens as liquidity/escrow, not as holders.
 * Excluded from holder counts (along with each token's own bonding curve and zero/dead).
 */
export const PROTOCOL_HOLDER_EXCLUSIONS: { address: string; label: string }[] = VIBE_DEPLOYMENTS.flatMap((d) =>
  Object.entries(d.extra).map(([label, address]) => ({ address: address!.toLowerCase(), label: `vibe/vibe ${d.id} ${label}` })),
).filter((x, i, arr) => arr.findIndex((y) => y.address === x.address) === i);

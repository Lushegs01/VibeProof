import { describe, expect, it } from "vitest";
import { getAddress, type Address, type Hex } from "viem";
import { analyzeContract, EIP1967, resolveProxy } from "@/lib/analysis/contract";
import { CAPABILITY_SELECTORS } from "@/lib/analysis/bytecode";

const PROXY = getAddress("0x00000000000000000000000000000000000000a1");
const BEACON = getAddress("0x00000000000000000000000000000000000000b1");
const IMPL = getAddress("0x00000000000000000000000000000000000000c1");
const ADMIN = getAddress("0x00000000000000000000000000000000000000d1");
const slot = (a: string) => `0x${"0".repeat(24)}${a.slice(2).toLowerCase()}` as Hex;
const RUNTIME = "0x6080604052" as Hex;

function fake(storage: Record<string, Hex>, opts: { beaconImpl?: Address | "revert"; code?: Record<string, Hex> } = {}) {
  return {
    getStorageAt: async (address: Address, s: Hex) => (address === PROXY ? storage[s] : undefined),
    readContract: async <T,>(a: { address: Address; functionName: string }) => {
      if (a.address === BEACON && a.functionName === "implementation") {
        if (opts.beaconImpl === "revert" || !opts.beaconImpl) throw new Error("execution reverted");
        return opts.beaconImpl as T;
      }
      throw new Error("execution reverted");
    },
  };
}

describe("proxy resolution", () => {
  it("REGRESSION: a beacon proxy's implementation comes from beacon.implementation(), never the beacon address", async () => {
    const p = await resolveProxy(fake({ [EIP1967.beacon]: slot(BEACON) }, { beaconImpl: IMPL }), PROXY, RUNTIME);
    expect(p.kind).toBe("beacon");
    expect(p.beacon).toBe(BEACON);
    expect(p.implementation).toBe(IMPL);
    expect(p.implementation).not.toBe(BEACON);
  });
  it("a beacon whose implementation() cannot be read yields NO implementation (not the beacon)", async () => {
    const p = await resolveProxy(fake({ [EIP1967.beacon]: slot(BEACON) }, { beaconImpl: "revert" }), PROXY, RUNTIME);
    expect(p.kind).toBe("beacon");
    expect(p.implementation).toBeNull();
    expect(p.note).toMatch(/could not be read/);
  });
  it("EIP-1967 implementation + admin slots", async () => {
    const p = await resolveProxy(fake({ [EIP1967.implementation]: slot(IMPL), [EIP1967.admin]: slot(ADMIN) }), PROXY, RUNTIME);
    expect(p).toMatchObject({ kind: "eip1967", implementation: IMPL, admin: ADMIN });
  });
  it("EIP-1167 minimal proxy from bytecode", async () => {
    const code = `0x363d3d373d3d3d363d73${IMPL.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3` as Hex;
    const p = await resolveProxy(fake({}), PROXY, code);
    expect(p).toMatchObject({ kind: "eip1167", implementation: IMPL });
  });
  it("no proxy", async () => {
    expect((await resolveProxy(fake({ [EIP1967.implementation]: `0x${"0".repeat(64)}` as Hex }), PROXY, RUNTIME)).kind).toBeNull();
  });
});

describe("analyzeContract on a proxy token", () => {
  it("scans the IMPLEMENTATION's bytecode for capabilities", async () => {
    const mint = CAPABILITY_SELECTORS.mint[0].selector.slice(2);
    const implCode = `0x63${mint}5b00` as Hex; // PUSH4 <mint selector>
    const provider = {
      slug: "robinhood-testnet" as const,
      chainId: 46630,
      getBlockNumber: async () => 100n,
      getBytecode: async (a: Address) => (a === PROXY ? RUNTIME : a === IMPL ? implCode : undefined),
      multicall: async (args: { contracts: unknown[] }) => args.contracts.map(() => ({ status: "failure" as const, error: new Error("execution reverted") })),
      ...fake({ [EIP1967.beacon]: slot(BEACON) }, { beaconImpl: IMPL }),
    };
    const noExplorer = { smartContract: async () => null, address: async () => null } as never;
    const a = await analyzeContract(provider as never, PROXY, noExplorer);
    expect(a.proxy).toMatchObject({ kind: "beacon", beacon: BEACON, implementation: IMPL });
    expect(a.capabilities.mint).toContain("mint(address,uint256)");
    const src = a.checks.find((c) => c.id === "source_verified")!;
    expect(src.state).toBe("unavailable"); // explorer down = unknown, never "not verified"
  });
});

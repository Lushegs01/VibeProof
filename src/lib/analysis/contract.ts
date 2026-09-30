import { getAddress, type Abi, type Address, type Hex } from "viem";
import type { ChainProvider } from "../chain/provider";
import { ERC20_ABI } from "../vibe/abis";
import { blockscout, type BlockscoutSmartContract } from "../explorer/blockscout";
import type { Evidence, VerificationState } from "../verification/types";
import { ZERO_ADDRESS } from "../util/address";
import {
  detectMinimalProxy,
  extractPush4Selectors,
  hasDelegatecall,
  matchCapabilities,
  matchCapabilitiesFromAbi,
  type CapabilityId,
} from "./bytecode";

/** EIP-1967 storage slots. */
export const EIP1967 = {
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
} as const;

export type CheckStatus = "detected" | "not_detected" | "unknown";

export type ContractCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  /** Formatted display value (address, number, text) when relevant. */
  value?: string | null;
  state: VerificationState;
  evidence: Evidence;
  /** Short note shown in the technical details panel. */
  note?: string;
};

export type TokenBasics = {
  exists: boolean;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
};

export type ContractAnalysis = {
  address: Address;
  chainId: number;
  block: string;
  observedAt: string;
  basics: TokenBasics;
  sourceVerified: boolean | null;
  contractName: string | null;
  proxy: { kind: "eip1967" | "eip1167" | "beacon" | "explorer" | null; implementation: Address | null; admin: Address | null };
  owner: Address | null;
  ownershipRenounced: boolean | null;
  capabilities: Record<CapabilityId, string[]>;
  checks: ContractCheck[];
  summary: { total: number; detected: number; notDetected: number; unknown: number };
};

const slotToAddress = (v: Hex | undefined): Address | null => {
  if (!v || /^0x0*$/.test(v)) return null;
  const a = getAddress("0x" + v.slice(-40));
  return a === ZERO_ADDRESS ? null : a;
};

export async function analyzeContract(provider: ChainProvider, address: Address): Promise<ContractAnalysis> {
  const observedAt = new Date().toISOString();
  const blockNumber = await provider.getBlockNumber();
  const block = blockNumber.toString();
  const rpcEv = (method: string, detail?: string): Evidence => ({
    source: "Robinhood Chain Testnet RPC",
    method,
    observedAt,
    block,
    contract: address,
    detail,
  });

  const code = await provider.getBytecode(address);
  const exists = !!code && code !== "0x";

  // Explorer is best-effort: failure means "unknown", never "not verified".
  const [explorerContract, explorerAddress] = await Promise.all([
    exists ? blockscout.smartContract(address) : Promise.resolve(null),
    exists ? blockscout.address(address) : Promise.resolve(null),
  ]);

  const checks: ContractCheck[] = [];
  checks.push({
    id: "bytecode",
    label: "Contract bytecode",
    status: exists ? "detected" : "not_detected",
    value: exists ? `${(code!.length - 2) / 2} bytes` : null,
    state: exists ? "verified" : "not_found",
    evidence: rpcEv("eth_getCode"),
  });

  const empty: TokenBasics = { exists, name: null, symbol: null, decimals: null, totalSupply: null };
  if (!exists) {
    return finish({ address, chainId: provider.chainId, block, observedAt, basics: empty, sourceVerified: null, contractName: null, proxy: { kind: null, implementation: null, admin: null }, owner: null, ownershipRenounced: null, capabilities: emptyCaps(), checks });
  }

  // ── ERC-20 basics + common admin views, in ONE multicall ──────────────────
  const fns = ["name", "symbol", "decimals", "totalSupply", "owner", "paused", "cap", "maxSupply"] as const;
  const results = await provider.multicall({
    contracts: fns.map((functionName) => ({ address, abi: ERC20_ABI as Abi, functionName })),
  });
  const r = Object.fromEntries(fns.map((f, i) => [f, results[i]?.status === "success" ? (results[i] as { result: unknown }).result : undefined])) as Record<(typeof fns)[number], unknown>;
  const basics: TokenBasics = {
    exists,
    name: typeof r.name === "string" ? r.name : null,
    symbol: typeof r.symbol === "string" ? r.symbol : null,
    decimals: typeof r.decimals === "number" ? r.decimals : null,
    totalSupply: typeof r.totalSupply === "bigint" ? r.totalSupply.toString() : null,
  };
  const isErc20 = basics.symbol !== null && basics.decimals !== null && basics.totalSupply !== null;
  checks.push({
    id: "erc20",
    label: "ERC-20 interface",
    status: isErc20 ? "detected" : "not_detected",
    value: isErc20 ? `${basics.symbol} · ${basics.decimals} decimals` : null,
    state: isErc20 ? "verified" : "not_found",
    evidence: rpcEv("multicall: name(), symbol(), decimals(), totalSupply()"),
  });

  // ── Source verification ───────────────────────────────────────────────────
  const sourceVerified =
    explorerContract?.is_verified ?? explorerAddress?.is_verified ?? (explorerContract || explorerAddress ? false : null);
  checks.push({
    id: "source_verified",
    label: "Source verification",
    status: sourceVerified === null ? "unknown" : sourceVerified ? "detected" : "not_detected",
    value: sourceVerified ? explorerContract?.name ?? "Verified" : sourceVerified === false ? "Not verified" : null,
    state: sourceVerified === null ? "unavailable" : sourceVerified ? "verified" : "not_found",
    evidence: {
      source: "Blockscout (Robinhood Chain Testnet explorer)",
      method: "GET /api/v2/smart-contracts/{address}",
      observedAt,
      contract: address,
      url: `https://explorer.testnet.chain.robinhood.com/address/${address}?tab=contract`,
      detail: explorerContract?.compiler_version ?? undefined,
    },
    note: sourceVerified === null ? "Explorer could not be reached." : undefined,
  });

  // ── Proxy detection ───────────────────────────────────────────────────────
  const minimal = detectMinimalProxy(code!);
  const [implSlot, adminSlot, beaconSlot] = await Promise.all([
    provider.getStorageAt(address, EIP1967.implementation),
    provider.getStorageAt(address, EIP1967.admin),
    provider.getStorageAt(address, EIP1967.beacon),
  ]);
  let proxy: ContractAnalysis["proxy"] = { kind: null, implementation: null, admin: slotToAddress(adminSlot) };
  if (minimal) proxy = { kind: "eip1167", implementation: getAddress(minimal), admin: null };
  else if (slotToAddress(implSlot)) proxy = { ...proxy, kind: "eip1967", implementation: slotToAddress(implSlot) };
  else if (slotToAddress(beaconSlot)) proxy = { ...proxy, kind: "beacon", implementation: slotToAddress(beaconSlot) };
  else if (explorerContract?.proxy_type && explorerContract.implementations?.length) {
    const impl = explorerContract.implementations[0];
    const implAddr = impl.address_hash ?? impl.address;
    proxy = { ...proxy, kind: "explorer", implementation: implAddr ? getAddress(implAddr) : null };
  }
  checks.push({
    id: "proxy",
    label: "Proxy",
    status: proxy.kind ? "detected" : "not_detected",
    value: proxy.implementation,
    state: proxy.kind ? "verified" : "observed",
    evidence: rpcEv("eth_getStorageAt (EIP-1967 implementation/admin/beacon slots) + EIP-1167 bytecode pattern"),
    note: proxy.kind ? `Pattern: ${proxy.kind}` : hasDelegatecall(code!) ? "No standard proxy slots set, but bytecode contains DELEGATECALL." : undefined,
  });

  // ── Capability detection ──────────────────────────────────────────────────
  let targetCode: Hex = code!;
  if (proxy.implementation) {
    const implCode = await provider.getBytecode(proxy.implementation);
    if (implCode && implCode !== "0x") targetCode = implCode;
  }
  const abi = explorerContract?.abi as BlockscoutSmartContract["abi"];
  const fromAbi = sourceVerified && abi?.length ? matchCapabilitiesFromAbi(abi as never) : null;
  const capabilities = fromAbi ?? matchCapabilities(extractPush4Selectors(targetCode));
  const capState: VerificationState = fromAbi ? "verified" : "observed";
  const capEvidence = fromAbi
    ? ({ source: "Blockscout verified ABI", method: "Function signature match against verified ABI", observedAt, contract: address } satisfies Evidence)
    : rpcEv(
        "4-byte selector scan of runtime bytecode" + (proxy.implementation ? ` (implementation ${proxy.implementation})` : ""),
        "Selector scan only detects standard function names. Custom-named admin functions are not detected.",
      );

  const capRows: [CapabilityId, string][] = [
    ["mint", "Mint authority"],
    ["burn", "Burn function"],
    ["pause", "Pause authority"],
    ["blacklist", "Blacklist mechanism"],
    ["whitelist", "Allowlist / fee exclusion"],
    ["roles", "Role-based access control"],
    ["upgrade", "Upgrade function"],
    ["fees", "Adjustable fees"],
    ["transfer_limits", "Transfer limits"],
    ["trading_toggle", "Trading enable switch"],
  ];
  for (const [id, label] of capRows) {
    const hits = capabilities[id];
    checks.push({
      id,
      label,
      status: hits.length ? "detected" : "not_detected",
      value: hits.length ? hits.join(", ") : null,
      state: capState,
      evidence: capEvidence,
    });
  }

  // ── Ownership ─────────────────────────────────────────────────────────────
  const owner = typeof r.owner === "string" ? getAddress(r.owner) : null;
  const ownershipRenounced = owner === null ? null : owner === ZERO_ADDRESS;
  checks.push({
    id: "owner",
    label: "Owner",
    status: owner === null ? "not_detected" : "detected",
    value: owner,
    state: owner === null ? (capabilities.ownership.length ? "unavailable" : "not_found") : "verified",
    evidence: rpcEv("eth_call owner()"),
    note: ownershipRenounced ? "owner() returns the zero address (renounced)." : owner === null ? "No owner() function responded." : undefined,
  });

  if (typeof r.paused === "boolean") {
    checks.push({ id: "paused_state", label: "Currently paused", status: r.paused ? "detected" : "not_detected", value: String(r.paused), state: "verified", evidence: rpcEv("eth_call paused()") });
  }
  const cap = typeof r.cap === "bigint" ? r.cap : typeof r.maxSupply === "bigint" ? r.maxSupply : null;
  checks.push({
    id: "max_supply",
    label: "Max supply",
    status: cap !== null ? "detected" : "not_detected",
    value: cap?.toString() ?? null,
    state: cap !== null ? "verified" : "not_found",
    evidence: rpcEv("eth_call cap() / maxSupply()"),
  });

  return finish({
    address,
    chainId: provider.chainId,
    block,
    observedAt,
    basics,
    sourceVerified,
    contractName: explorerContract?.name ?? null,
    proxy,
    owner,
    ownershipRenounced,
    capabilities,
    checks,
  });
}

function emptyCaps() {
  return { mint: [], burn: [], pause: [], blacklist: [], whitelist: [], ownership: [], roles: [], upgrade: [], fees: [], transfer_limits: [], trading_toggle: [] } as Record<CapabilityId, string[]>;
}

function finish(a: Omit<ContractAnalysis, "summary">): ContractAnalysis {
  const s = { total: a.checks.length, detected: 0, notDetected: 0, unknown: 0 };
  for (const c of a.checks) {
    if (c.status === "detected") s.detected++;
    else if (c.status === "not_detected") s.notDetected++;
    else s.unknown++;
  }
  return { ...a, summary: s };
}

/** Checks that give a holder of the relevant key power over other holders. Displayed neutrally as "admin capabilities". */
export const ADMIN_CAPABILITY_IDS = ["mint", "pause", "blacklist", "upgrade", "fees", "transfer_limits", "trading_toggle"] as const;

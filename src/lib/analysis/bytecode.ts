import { toFunctionSelector, type Hex } from "viem";

/**
 * Extract every PUSH4 immediate from runtime bytecode, skipping PUSH data
 * correctly so we never read an immediate as an opcode. Solidity/Vyper
 * dispatchers compare calldata against PUSH4 selectors, so presence here is
 * strong (but not absolute) evidence that the function exists.
 */
export function extractPush4Selectors(code: Hex): Set<string> {
  const bytes = hexToBytes(code);
  const out = new Set<string>();
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i];
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      if (op === 0x63 && i + 4 < bytes.length) {
        out.add("0x" + toHex(bytes.subarray(i + 1, i + 5)));
      }
      i += n;
    }
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(Math.floor(h.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function toHex(b: Uint8Array) {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** EIP-1167 minimal proxy: 363d3d373d3d3d363d73<20 bytes>5af43d82803e903d91602b57fd5bf3 */
export function detectMinimalProxy(code: Hex): `0x${string}` | null {
  const m = code.toLowerCase().match(/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/);
  return m ? (`0x${m[1]}` as `0x${string}`) : null;
}

export function hasDelegatecall(code: Hex): boolean {
  const bytes = hexToBytes(code);
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i];
    if (op === 0xf4) return true;
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  return false;
}

export type CapabilityId =
  | "mint"
  | "burn"
  | "pause"
  | "blacklist"
  | "whitelist"
  | "ownership"
  | "roles"
  | "upgrade"
  | "fees"
  | "transfer_limits"
  | "trading_toggle";

/**
 * Function signatures associated with each capability. Detection is by 4-byte
 * selector, so custom-named functions won't be caught — the UI states this
 * limitation on every "not detected" row.
 */
export const CAPABILITY_SIGNATURES: Record<CapabilityId, string[]> = {
  mint: ["mint(address,uint256)", "mint(uint256)", "mintTo(address,uint256)", "issue(uint256)"],
  burn: ["burn(uint256)", "burnFrom(address,uint256)", "burn(address,uint256)"],
  pause: ["pause()", "unpause()", "setPaused(bool)"],
  blacklist: [
    "blacklist(address)",
    "addToBlacklist(address)",
    "setBlacklist(address,bool)",
    "blacklistAddress(address,bool)",
    "addBlackList(address)",
    "setBots(address[],bool)",
    "setBot(address,bool)",
    "blockAddress(address)",
    "isBlacklisted(address)",
  ],
  whitelist: ["whitelist(address)", "setWhitelist(address,bool)", "addToWhitelist(address)", "excludeFromFees(address,bool)", "setExcludedFromFee(address,bool)"],
  ownership: ["owner()", "transferOwnership(address)", "renounceOwnership()", "acceptOwnership()"],
  roles: ["grantRole(bytes32,address)", "revokeRole(bytes32,address)", "hasRole(bytes32,address)"],
  upgrade: ["upgradeTo(address)", "upgradeToAndCall(address,bytes)", "changeAdmin(address)"],
  fees: [
    "setFee(uint256)",
    "setFees(uint256,uint256)",
    "setTaxFee(uint256)",
    "setBuyFee(uint256)",
    "setSellFee(uint256)",
    "setTax(uint256)",
    "updateFees(uint256,uint256)",
    "setBuyTax(uint256)",
    "setSellTax(uint256)",
  ],
  transfer_limits: ["setMaxTxAmount(uint256)", "setMaxWalletSize(uint256)", "setMaxTx(uint256)", "setMaxWallet(uint256)", "removeLimits()", "setCooldown(uint256)"],
  trading_toggle: ["enableTrading()", "openTrading()", "setTradingEnabled(bool)", "setTrading(bool)", "startTrading()"],
};

export const CAPABILITY_SELECTORS: Record<CapabilityId, { sig: string; selector: string }[]> = Object.fromEntries(
  Object.entries(CAPABILITY_SIGNATURES).map(([k, sigs]) => [k, sigs.map((sig) => ({ sig, selector: toFunctionSelector(`function ${sig}`) }))]),
) as never;

export function matchCapabilities(selectors: Set<string>) {
  const res = {} as Record<CapabilityId, string[]>;
  for (const [cap, list] of Object.entries(CAPABILITY_SELECTORS) as [CapabilityId, { sig: string; selector: string }[]][]) {
    res[cap] = list.filter((x) => selectors.has(x.selector)).map((x) => x.sig);
  }
  return res;
}

/** Same match, but against a verified ABI's function names (stronger evidence). */
export function matchCapabilitiesFromAbi(abi: { type: string; name?: string; inputs?: { type: string }[] }[]) {
  const sigs = new Set(abi.filter((x) => x.type === "function" && x.name).map((x) => `${x.name}(${(x.inputs ?? []).map((i) => i.type).join(",")})`));
  const res = {} as Record<CapabilityId, string[]>;
  for (const [cap, list] of Object.entries(CAPABILITY_SIGNATURES) as [CapabilityId, string[]][]) res[cap] = list.filter((s) => sigs.has(s));
  return res;
}

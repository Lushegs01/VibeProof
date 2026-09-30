import { getAddress, type Address } from "viem";
import type { TokenPassport, ChangesResponse } from "../services/types";
import type { ContractAnalysis, ContractCheck } from "../analysis/contract";
import type { Evidence } from "../verification/types";

/**
 * DEMO DATA — deterministic fixtures for local development and E2E tests.
 * Served only when NEXT_PUBLIC_DEMO_MODE=true. Addresses use the 0xde00… prefix
 * so they are recognisable and cannot collide with real Vibe launches in practice.
 * Every response built from this module carries `demo: true` and the UI labels it.
 */
const T0 = Date.parse("2026-09-27T12:00:00Z");
const iso = (hoursAfterT0: number) => new Date(T0 + hoursAfterT0 * 3600_000).toISOString();
const A = (n: number) => getAddress(`0xde00000000000000000000000000000000${n.toString(16).padStart(6, "0")}`);

export const DEMO_CREATORS = [A(0xc0001), A(0xc0002)];

type DemoToken = { addr: Address; name: string; symbol: string; creator: Address; hours: number; holders: number; txs: number; buys: number; sells: number; buyers: number; sellers: number; volume: string; proof: 0 | 1 | 2 | 3; mint: boolean; verified: boolean; graduated: boolean };

export const DEMO_TOKENS: DemoToken[] = [
  { addr: A(0x70001), name: "Lattice Agents", symbol: "LATTICE", creator: DEMO_CREATORS[0], hours: 0, holders: 427, txs: 1284, buys: 902, sells: 187, buyers: 421, sellers: 97, volume: "18.42", proof: 3, mint: false, verified: true, graduated: false },
  { addr: A(0x70002), name: "Quiet Ledger", symbol: "QLDG", creator: DEMO_CREATORS[0], hours: 30, holders: 96, txs: 311, buys: 210, sells: 71, buyers: 90, sellers: 33, volume: "3.07", proof: 2, mint: false, verified: false, graduated: false },
  { addr: A(0x70003), name: "Paper Robot", symbol: "PPRBT", creator: DEMO_CREATORS[1], hours: 50, holders: 1210, txs: 5420, buys: 3804, sells: 1301, buyers: 1150, sellers: 512, volume: "71.9", proof: 1, mint: true, verified: true, graduated: true },
  { addr: A(0x70004), name: "Northwind", symbol: "NWIND", creator: DEMO_CREATORS[1], hours: 64, holders: 12, txs: 19, buys: 14, sells: 2, buyers: 12, sellers: 2, volume: "0.21", proof: 0, mint: false, verified: false, graduated: false },
];

const ev = (method: string, extra: Partial<Evidence> = {}): Evidence => ({ source: "DEMO DATA", method, observedAt: iso(72), block: "126600000", ...extra });

function demoAnalysis(t: DemoToken): ContractAnalysis {
  const row = (id: string, label: string, detected: boolean, value: string | null = null): ContractCheck => ({
    id,
    label,
    status: detected ? "detected" : "not_detected",
    value,
    state: t.verified ? "verified" : "observed",
    evidence: ev(t.verified ? "Function signature match against verified ABI" : "4-byte selector scan of runtime bytecode", { contract: t.addr }),
  });
  const checks: ContractCheck[] = [
    { id: "bytecode", label: "Contract bytecode", status: "detected", value: "11,264 bytes", state: "verified", evidence: ev("eth_getCode") },
    { id: "erc20", label: "ERC-20 interface", status: "detected", value: `${t.symbol} · 18 decimals`, state: "verified", evidence: ev("multicall") },
    { id: "source_verified", label: "Source verification", status: t.verified ? "detected" : "not_detected", value: t.verified ? "VibeToken" : "Not verified", state: t.verified ? "verified" : "not_found", evidence: ev("GET /api/v2/smart-contracts/{address}") },
    { id: "proxy", label: "Proxy", status: "not_detected", value: null, state: "observed", evidence: ev("EIP-1967 slots") },
    row("mint", "Mint authority", t.mint, t.mint ? "mint(address,uint256)" : null),
    row("burn", "Burn function", true, "burn(uint256)"),
    row("pause", "Pause authority", false),
    row("blacklist", "Blacklist mechanism", false),
    row("whitelist", "Allowlist / fee exclusion", false),
    row("roles", "Role-based access control", false),
    row("upgrade", "Upgrade function", false),
    row("fees", "Adjustable fees", false),
    row("transfer_limits", "Transfer limits", false),
    row("trading_toggle", "Trading enable switch", false),
    { id: "owner", label: "Owner", status: t.mint ? "detected" : "not_detected", value: t.mint ? t.creator : null, state: t.mint ? "verified" : "not_found", evidence: ev("eth_call owner()") },
  ];
  const detected = checks.filter((c) => c.status === "detected").length;
  return {
    address: t.addr,
    chainId: 46630,
    block: "126600000",
    observedAt: iso(72),
    basics: { exists: true, name: t.name, symbol: t.symbol, decimals: 18, totalSupply: "1000000000000000000000000000" },
    sourceVerified: t.verified,
    contractName: t.verified ? "VibeToken" : null,
    proxy: { kind: null, implementation: null, admin: null },
    owner: t.mint ? t.creator : null,
    ownershipRenounced: null,
    capabilities: { mint: t.mint ? ["mint(address,uint256)"] : [], burn: ["burn(uint256)"], pause: [], blacklist: [], whitelist: [], ownership: [], roles: [], upgrade: [], fees: [], transfer_limits: [], trading_toggle: [] },
    checks,
    summary: { total: checks.length, detected, notDetected: checks.length - detected, unknown: 0 },
  };
}

export function demoPassport(address: string): TokenPassport | null {
  const t = DEMO_TOKENS.find((x) => x.addr.toLowerCase() === address.toLowerCase());
  if (!t) return null;
  const o = <T,>(value: T, method: string) => ({ value, state: "observed" as const, evidence: ev(method, { contract: t.addr }) });
  const launchesBy = DEMO_TOKENS.filter((x) => x.creator === t.creator);
  const proofTypes = (["website", "github", "demo"] as const).slice(0, t.proof);
  return {
    chain: "robinhood-testnet",
    chainId: 46630,
    address: t.addr,
    name: t.name,
    symbol: t.symbol,
    decimals: 18,
    totalSupply: "1000000000000000000000000000",
    isVibeLaunch: true,
    createdAt: iso(t.hours),
    metadataUri: null,
    launch: { deploymentId: "v6-run15", factory: "0xe794217880011f9cA6961340eD5c16EC9559Fea0", launchId: String(t.hours), curve: A(0xcc000 + t.hours), pairCurrency: null, txHash: `0x${"de".repeat(31)}${t.hours.toString(16).padStart(2, "0")}`, blockNumber: String(126000000 + t.hours * 20000), createdAt: iso(t.hours), status: t.graduated ? "graduated" : "bonding", graduatedAt: t.graduated ? iso(t.hours + 20) : null },
    contract: demoAnalysis(t),
    creator: { address: t.creator, firstSeenAt: iso(launchesBy[0].hours), launchCount: launchesBy.length, graduatedLaunchCount: launchesBy.filter((x) => x.graduated).length, activeLaunchCount: launchesBy.filter((x) => !x.graduated).length, historicalLaunchCount: 0, evidence: ev("Launch events grouped by launcher") },
    activity: {
      holders: o(t.holders, "Net balances from Transfer events"),
      transactions: o(t.txs, "Count of Transfer events"),
      buys: o(t.buys, "Curve buy events"),
      sells: o(t.sells, "Curve sell events"),
      buyers: o(t.buyers, "Distinct buyers"),
      sellers: o(t.sellers, "Distinct sellers"),
      volumeEth: o(t.volume, "Sum of ETH in curve trades"),
      lastActivityAt: o(iso(71.5), "Latest event"),
    },
    proof: {
      submitted: t.proof > 0,
      submittedBy: t.proof > 0 ? t.creator : null,
      submitterIsCreator: t.proof > 0,
      submittedAt: t.proof > 0 ? iso(t.hours + 2) : null,
      description: t.proof > 0 ? `${t.name} (demo project description, creator-provided).` : null,
      metadataHash: null,
      registryTx: null,
      checks: proofTypes.map((type) => ({
        type,
        url: type === "github" ? `https://github.com/demo/${t.symbol.toLowerCase()}` : `https://${t.symbol.toLowerCase()}.demo.invalid${type === "demo" ? "/app" : ""}`,
        state: type === "github" ? ("observed" as const) : ("verified" as const),
        summary: type === "github" ? "Repository found" : "Reachable; page references this contract address",
        facts: (type === "github" ? { exists: true, commits30d: 27, contributors: 4, stars: 58, lastCommitAt: iso(69), hasReadme: true, releases: 2 } : { reachable: true, status: 200, tls: true, mentionsContract: true }) as Record<string, string | number | boolean | null>,
        evidence: ev(type === "github" ? "GitHub REST API" : "HTTP probe"),
      })),
      score: { observed: t.proof, total: 3 },
    },
    recent: Array.from({ length: 8 }, (_, i) => ({ txHash: `0x${(i + 1).toString(16).padStart(2, "0")}${"ab".repeat(31)}`, logIndex: i, blockNumber: String(126599990 - i * 37), timestamp: iso(71.9 - i * 0.3), type: i % 3 === 2 ? "sell" : "buy", wallet: A(0xa0000 + i), amount: String(BigInt(1000 + i * 250) * 10n ** 18n), quoteAmount: String(BigInt(5 + i) * 10n ** 16n) })),
    topHolders: [
      { wallet: A(0xa0001), balance: String(42_000_000n * 10n ** 18n), pct: 4.2 },
      { wallet: A(0xa0002), balance: String(31_500_000n * 10n ** 18n), pct: 3.15 },
      { wallet: A(0xa0003), balance: String(18_000_000n * 10n ** 18n), pct: 1.8 },
    ],
    indexer: { indexedThrough: "126600000", covered: true },
    observedAt: iso(72),
    demo: true,
  };
}

export function demoChanges(address: string): ChangesResponse | null {
  const t = DEMO_TOKENS.find((x) => x.addr.toLowerCase() === address.toLowerCase());
  if (!t) return null;
  const f = (n: number, pct: number) => Math.round(n * pct);
  return {
    since: iso(48),
    baselineAt: iso(48),
    baselineExact: true,
    diffs: [
      { metric: "holders", label: "holders", previous: t.holders - f(t.holders, 0.3), current: t.holders, delta: f(t.holders, 0.3) },
      { metric: "transactions", label: "transactions", previous: t.txs - f(t.txs, 0.33), current: t.txs, delta: f(t.txs, 0.33) },
      { metric: "buyers", label: "unique buyers", previous: t.buyers - f(t.buyers, 0.1), current: t.buyers, delta: f(t.buyers, 0.1) },
      { metric: "volume", label: "ETH observed volume", previous: 0, current: Number(t.volume), delta: 0.37 },
    ],
    events: [
      { kind: "github", message: "GitHub repository updated", at: iso(69), txHash: null },
      { kind: "creator_activity", message: "Creator wallet bought on the bonding curve", at: iso(60), txHash: `0x${"cd".repeat(32)}` },
    ],
  };
}

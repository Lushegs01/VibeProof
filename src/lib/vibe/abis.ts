import { parseAbi, parseAbiItem } from "viem";

/**
 * vibe/vibe event ABIs, taken from the public app bundle served at https://testnet.vibevibe.fun
 * (modules `abis-*.js`, `V6TradingProvider-*.js`, `domain-shared-*.js`; re-checked 2026-10-03).
 *
 * "OBSERVED" means the topic0 was seen in real logs of the configured contracts on Robinhood
 * Chain Testnet, with counts from a full-history scan on 2026-10-03 (docs/assessment.md §7).
 */
export const VIBE_EVENTS = {
  /** v6 factory — topic0 0xa7e8032b… OBSERVED (4,069 on factory 0xe794…Fea0). */
  LaunchCreated: parseAbiItem(
    "event LaunchCreated(uint256 indexed launchId, address indexed launcher, address indexed token, address curve, string name, string symbol, string metadataURI, address pairCurrency, uint16 taxBps, uint64 packedWeights, address projectTreasury, uint256 targetPairUnits, uint256 netPersonal, uint256 giftNetTotal, bytes32 giftRoot, uint256 giftCount)",
  ),
  /** v5 factory — topic0 0x56eef5c3… OBSERVED (142,384 on factory 0x40f1…DF59). ETH-quoted curve. */
  TokenLaunched: parseAbiItem(
    "event TokenLaunched(uint256 indexed launchId, address indexed token, address indexed curve, address creator, address creatorFeeRecipient, address creatorVault, uint256 initialBuy, uint256 initialTokensBought, uint16 metadataSchemaVersion, bytes32 metadataDigest, string metadataURI)",
  ),
  /** v5 factory — topic0 0x34041bc5… OBSERVED (1, launch 2423, block 116,883,321). Curve quoted in `quoteCurrency`. */
  TokenLaunchedQuoted: parseAbiItem(
    "event TokenLaunchedQuoted(uint256 indexed launchId, address indexed token, address indexed curve, address creator, address creatorFeeRecipient, address creatorVault, address quoteCurrency, uint256 initialBuy, uint256 initialTokensBought, uint16 metadataSchemaVersion, bytes32 metadataDigest, string metadataURI)",
  ),
  /** v6 curve — topic0 0x55867fe9… OBSERVED. Trader = recipient (as in the vibe/vibe app). */
  CurveBuy: parseAbiItem(
    "event CurveBuy(address indexed buyer, address indexed recipient, uint256 grossTokens, uint256 netTokens, uint256 tokenFee, uint256 pairCost, uint256 pairFee, uint256 rateBps)",
  ),
  /** v6 curve — topic0 0x3899b2b9… OBSERVED. Trader = seller. */
  CurveSell: parseAbiItem(
    "event CurveSell(address indexed seller, address indexed recipient, uint256 grossTokens, uint256 netTokens, uint256 tokenFee, uint256 pairProceeds, uint256 pairFee)",
  ),
  /** v5 curve — topic0 0x8a525443… OBSERVED (196 on one recent v5 curve). */
  Bought: parseAbiItem(
    "event Bought(address indexed buyer, address indexed recipient, uint256 grossEthUsed, uint256 curveQuote, uint256 tokenAmount, uint256 creatorFee, uint256 protocolFee)",
  ),
  /** v5 curve — topic0 0x917d0fe1… OBSERVED (813 on one recent v5 curve). */
  Sold: parseAbiItem(
    "event Sold(address indexed seller, uint256 tokenAmount, uint256 grossCurveQuote, uint256 ethReceived, uint256 creatorFee, uint256 protocolFee)",
  ),
  /** v5 curve — topic0 0x654e1d49… OBSERVED. The curve reached its target; NOT the same as graduation. */
  CurveCompleted: parseAbiItem("event CurveCompleted(uint256 netEthReserve, uint256 timestamp)"),
  /** v5 curve — topic0 0xc1eaf644… OBSERVED. Also emitted by unrelated contracts: only trusted from a registered curve. */
  Graduated: parseAbiItem("event Graduated(bytes32 indexed poolId, uint256 ethAmount, uint256 tokenAmount)"),
  /** v6 curve — topic0 0xab164bba… OBSERVED (e.g. tx 0xb8e17636…; the balance then moved to the Uniswap v4 PoolManager). */
  GraduatedV6: parseAbiItem(
    "event Graduated(bytes32 indexed poolId, uint256 pairAmount, uint256 tokenAmount, uint256 leftoverBurned)",
  ),
} as const;

export const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function cap() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
]);

export const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

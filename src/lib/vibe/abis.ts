import { parseAbi, parseAbiItem } from "viem";

/**
 * Event ABIs taken from the official vibe/vibe app bundle (modules `abis-*.js`,
 * `V6TradingProvider-*.js`). A signature is marked `observed` only if its topic0
 * was actually seen in logs of the configured contracts on 2026-09-30.
 */
export const VIBE_EVENTS = {
  /** v6 factory — topic0 0xa7e8032b… OBSERVED on factory 0xe794…Fea0 */
  LaunchCreated: parseAbiItem(
    "event LaunchCreated(uint256 indexed launchId, address indexed launcher, address indexed token, address curve, string name, string symbol, string metadataURI, address pairCurrency, uint16 taxBps, uint64 packedWeights, address projectTreasury, uint256 targetPairUnits, uint256 netPersonal, uint256 giftNetTotal, bytes32 giftRoot, uint256 giftCount)",
  ),
  /** v5 factory — topic0 0x56eef5c3… OBSERVED on factory 0x40f1…DF59 */
  TokenLaunched: parseAbiItem(
    "event TokenLaunched(uint256 indexed launchId, address indexed token, address indexed curve, address creator, address creatorFeeRecipient, address creatorVault, uint256 initialBuy, uint256 initialTokensBought, uint16 metadataSchemaVersion, bytes32 metadataDigest, string metadataURI)",
  ),
  /** v6 curve — topic0 0x55867fe9… OBSERVED on a v6 curve */
  CurveBuy: parseAbiItem(
    "event CurveBuy(address indexed buyer, address indexed recipient, uint256 grossTokens, uint256 netTokens, uint256 tokenFee, uint256 pairCost, uint256 pairFee, uint256 rateBps)",
  ),
  /** v6 curve — topic0 0x3899b2b9… OBSERVED on v6 curve 0x52b4…b776 */
  CurveSell: parseAbiItem(
    "event CurveSell(address indexed seller, address indexed recipient, uint256 grossTokens, uint256 netTokens, uint256 tokenFee, uint256 pairProceeds, uint256 pairFee)",
  ),
  /** v5 curve — from app bundle, NOT yet observed */
  Bought: parseAbiItem(
    "event Bought(address indexed buyer, address indexed recipient, uint256 grossEthUsed, uint256 curveQuote, uint256 tokenAmount, uint256 creatorFee, uint256 protocolFee)",
  ),
  /** v5 curve — from app bundle, NOT yet observed */
  Sold: parseAbiItem(
    "event Sold(address indexed seller, uint256 tokenAmount, uint256 grossCurveQuote, uint256 ethReceived, uint256 creatorFee, uint256 protocolFee)",
  ),
  /** from app bundle, NOT yet observed */
  CurveCompleted: parseAbiItem("event CurveCompleted(uint256 netEthReserve, uint256 timestamp)"),
  /** v5 variant from app bundle, NOT yet observed. */
  Graduated: parseAbiItem("event Graduated(bytes32 indexed poolId, uint256 ethAmount, uint256 tokenAmount)"),
  /** v6 curve — topic0 0xab164bba… OBSERVED on v6 curve 0x52b4…b776 (tx 0xb8e17636…), after which the token balance moved to the Uniswap v4 PoolManager. */
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

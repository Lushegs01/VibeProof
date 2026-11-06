import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/**
 * Conventions
 *  - Every chain-derived row carries chain_id; mainnet and testnet never share keys.
 *  - Addresses are stored lowercase (varchar 42). Display layer checksums them.
 *  - Token amounts are numeric(78,0) (uint256-safe), never float.
 *  - Nullable metric columns mean "unknown", never zero.
 *  - Every chain event is identified by (chain_id, tx_hash, log_index).
 */
const addr = (name: string) => varchar(name, { length: 42 });
const hash = (name: string) => varchar(name, { length: 66 });
const uint = (name: string) => numeric(name, { precision: 78, scale: 0 });

export const tokens = pgTable(
  "tokens",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    address: addr("address").notNull(),
    name: text("name"),
    symbol: text("symbol"),
    decimals: integer("decimals"),
    totalSupply: uint("total_supply"),
    creatorAddress: addr("creator_address"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    createdBlock: bigint("created_block", { mode: "bigint" }),
    createdTx: varchar("created_tx", { length: 66 }),
    verifiedContract: boolean("verified_contract"),
    metadataUri: text("metadata_uri"),
    metadata: jsonb("metadata"),
    /** Latest contract analysis, cached so pages never re-run it per request. */
    analysis: jsonb("analysis"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    isVibeLaunch: boolean("is_vibe_launch").notNull().default(false),
    /** Launchpad adapter id that announced this token ("vibe"); null for tokens only seen via analysis. */
    launchpad: text("launchpad"),
    /**
     * true once the indexer holds this token's COMPLETE event history (from its creation block),
     * either because it launched after the activity start block or via a completed backfill.
     * Counters are only presented as observed when this is true.
     */
    activityCovered: boolean("activity_covered").notNull().default(false),
    /** Denormalised counters maintained by the indexer. null = not indexed yet. */
    holderCount: integer("holder_count"),
    transferCount: integer("transfer_count"),
    buyCount: integer("buy_count"),
    sellCount: integer("sell_count"),
    uniqueBuyers: integer("unique_buyers"),
    uniqueSellers: integer("unique_sellers"),
    volumeWei: uint("volume_wei"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    /** ERC-20 view reads at launch indexing: "ok" | "partial" (some calls reverted) | "error" (RPC failed; retried). */
    tokenMetaStatus: text("token_meta_status"),
    tokenMetaError: text("token_meta_error"),
    tokenMetaBlock: bigint("token_meta_block", { mode: "bigint" }),
    tokenMetaAttempts: integer("token_meta_attempts").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tokens_chain_address_uq").on(t.chainId, t.address),
    index("tokens_creator_idx").on(t.creatorAddress),
    index("tokens_symbol_idx").on(t.symbol),
    index("tokens_created_idx").on(t.createdAt),
    index("tokens_chain_created_idx").on(t.chainId, t.createdAt),
    index("tokens_chain_symbol_lower_idx").using("btree", t.chainId, sql`lower(${t.symbol}) text_pattern_ops`),
    index("tokens_chain_name_lower_idx").using("btree", t.chainId, sql`lower(${t.name}) text_pattern_ops`),
    index("tokens_chain_holders_idx").on(t.chainId, t.holderCount),
    index("tokens_chain_transfers_idx").on(t.chainId, t.transferCount),
    index("tokens_chain_active_idx").on(t.chainId, t.lastActivityAt),
    index("tokens_meta_status_idx").on(t.chainId, t.tokenMetaStatus),
  ],
);

export const creators = pgTable(
  "creators",
  {
    chainId: integer("chain_id").notNull(),
    address: addr("address").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    launchCount: integer("launch_count").notNull().default(0),
    activeLaunchCount: integer("active_launch_count").notNull().default(0),
    graduatedLaunchCount: integer("graduated_launch_count").notNull().default(0),
    historicalLaunchCount: integer("historical_launch_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.address] })],
);

export const launches = pgTable(
  "launches",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    creatorAddress: addr("creator_address").notNull(),
    factoryAddress: addr("factory_address").notNull(),
    deploymentId: text("deployment_id").notNull(),
    launchpad: text("launchpad").notNull().default("vibe"),
    version: text("version"),
    eventName: text("event_name"),
    launchId: uint("launch_id"),
    curveAddress: addr("curve_address"),
    pairCurrency: addr("pair_currency"),
    txHash: varchar("tx_hash", { length: 66 }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: hash("block_hash"),
    logIndex: integer("log_index"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /** false when created_at was interpolated between block headers (see indexer/timestamps.ts). */
    createdAtExact: boolean("created_at_exact"),
    /** Onchain commitment to the metadata bytes (v5: keccak256), when the launch event carries one. */
    metadataDigest: hash("metadata_digest"),
    graduatedAt: timestamp("graduated_at", { withTimezone: true }),
    graduatedTx: hash("graduated_tx"),
    graduatedBlock: bigint("graduated_block", { mode: "bigint" }),
    curveCompletedAt: timestamp("curve_completed_at", { withTimezone: true }),
    /** "bonding" | "curve_completed" | "graduated" — only set from observed curve events. */
    status: text("status").notNull().default("bonding"),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("launches_chain_token_uq").on(t.chainId, t.tokenAddress),
    index("launches_creator_idx").on(t.creatorAddress),
    index("launches_curve_idx").on(t.curveAddress),
    index("launches_created_idx").on(t.createdAt),
    index("launches_chain_creator_idx").on(t.chainId, t.creatorAddress),
    index("launches_chain_curve_idx").on(t.chainId, t.curveAddress),
    index("launches_chain_tx_idx").on(t.chainId, t.txHash),
    index("launches_chain_block_idx").on(t.chainId, t.blockNumber),
    index("launches_chain_status_idx").on(t.chainId, t.status, t.graduatedAt),
  ],
);

export const holders = pgTable(
  "holders",
  {
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    walletAddress: addr("wallet_address").notNull(),
    balance: uint("balance").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.tokenAddress, t.walletAddress] }),
    index("holders_wallet_idx").on(t.walletAddress),
    index("holders_token_balance_idx").on(t.chainId, t.tokenAddress, t.balance),
  ],
);

export const transactionEvents = pgTable(
  "transaction_events",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    txHash: varchar("tx_hash", { length: 66 }).notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: hash("block_hash"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    /** false = interpolated between block headers; null = recorded before this was tracked. */
    timestampExact: boolean("timestamp_exact"),
    tokenAddress: addr("token_address").notNull(),
    walletAddress: addr("wallet_address"),
    counterparty: addr("counterparty"),
    /** "transfer" | "buy" | "sell" | "graduation" | "curve_completed" */
    eventType: text("event_type").notNull(),
    /** Source event name (e.g. "CurveBuy", "Bought", "Transfer"). */
    eventName: text("event_name"),
    amount: uint("amount"),
    /** Native / pair-currency amount for buys & sells. */
    quoteAmount: uint("quote_amount"),
  },
  (t) => [
    uniqueIndex("tx_events_uq").on(t.chainId, t.txHash, t.logIndex),
    index("tx_events_token_time_idx").on(t.tokenAddress, t.timestamp),
    index("tx_events_wallet_idx").on(t.walletAddress),
    index("tx_events_time_idx").on(t.timestamp),
    index("tx_events_chain_token_block_idx").on(t.chainId, t.tokenAddress, t.blockNumber, t.logIndex),
    index("tx_events_chain_block_idx").on(t.chainId, t.blockNumber),
    index("tx_events_chain_type_time_idx").on(t.chainId, t.eventType, t.timestamp),
  ],
);

export const projectProofs = pgTable(
  "project_proofs",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    websiteUrl: text("website_url"),
    githubUrl: text("github_url"),
    demoUrl: text("demo_url"),
    docsUrl: text("docs_url"),
    twitterUrl: text("twitter_url"),
    discordUrl: text("discord_url"),
    description: text("description"),
    submittedBy: addr("submitted_by").notNull(),
    /** true when submitter == indexed creator of the launch (checked server-side). */
    submitterIsCreator: boolean("submitter_is_creator").notNull().default(false),
    metadataHash: varchar("metadata_hash", { length: 66 }),
    registryTx: varchar("registry_tx", { length: 66 }),
    metadataUri: text("metadata_uri"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("proofs_chain_token_uq").on(t.chainId, t.tokenAddress)],
);

export const verificationChecks = pgTable(
  "verification_checks",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    /** "website" | "github" | "demo" | "docs" | ... ; "metadata_*" for links claimed in launch metadata. */
    checkType: text("check_type").notNull(),
    /** VerificationState */
    status: text("status").notNull(),
    evidence: jsonb("evidence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("checks_token_type_time_idx").on(t.tokenAddress, t.checkType, t.observedAt)],
);

export const activitySnapshots = pgTable(
  "activity_snapshots",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    holders: integer("holders"),
    transactions: integer("transactions"),
    buyers: integer("buyers"),
    sellers: integer("sellers"),
    volume: uint("volume"),
    graduationProgress: numeric("graduation_progress", { precision: 7, scale: 4 }),
    githubPushedAt: timestamp("github_pushed_at", { withTimezone: true }),
    creatorTxCount: integer("creator_tx_count"),
  },
  (t) => [index("snapshots_token_time_idx").on(t.tokenAddress, t.timestamp)],
);

/** Ecosystem-wide event feed (derived). Trades are read straight from transaction_events. */
export const feedEvents = pgTable(
  "feed_events",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    txHash: varchar("tx_hash", { length: 66 }),
    /** Block of the underlying event (null for off-chain events such as proof submissions). Used for reorg rollback. */
    blockNumber: bigint("block_number", { mode: "bigint" }),
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("feed_time_idx").on(t.createdAt),
    uniqueIndex("feed_dedupe_uq").on(t.chainId, t.kind, t.tokenAddress, t.txHash),
    index("feed_chain_time_idx").on(t.chainId, t.createdAt),
    index("feed_chain_block_idx").on(t.chainId, t.blockNumber),
  ],
);

/** Cursors. Keys always embed the chain id (e.g. `activity:46630`, `launches:46630:v6-run15`). */
export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Block headers seen by the indexer: reorg checkpoints (the hash of every committed range end)
 * and a persistent timestamp-anchor cache, so serverless runs do not refetch headers.
 */
export const chainBlocks = pgTable(
  "chain_blocks",
  {
    chainId: integer("chain_id").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: hash("block_hash").notNull(),
    parentHash: hash("parent_hash").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    /** true = end of a committed indexing range (used for reorg detection). */
    checkpoint: boolean("checkpoint").notNull().default(false),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.blockNumber] }), index("chain_blocks_checkpoint_idx").on(t.chainId, t.checkpoint, t.blockNumber)],
);

/**
 * Historical activity backfill queue (one row per token).
 * status: pending → started → completed | failed (retried with backoff) → dead (after max attempts).
 */
export const backfillQueue = pgTable(
  "backfill_queue",
  {
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    status: text("status").notNull().default("pending"),
    /** "bootstrap" (automatic historical sync) | "on_demand" (passport viewed) | "manual" */
    reason: text("reason"),
    priority: integer("priority").notNull().default(0),
    launchBlock: bigint("launch_block", { mode: "bigint" }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    /** Activity cursor the backfill covered up to (the tail continues from there). */
    throughBlock: bigint("through_block", { mode: "bigint" }),
    /** Last error message (redacted). */
    error: text("error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.tokenAddress] }), index("backfill_claim_idx").on(t.chainId, t.status, t.priority, t.launchBlock)],
);

/**
 * Launch metadata fetched from the URI in the launch event. Contents are CREATOR CLAIMS:
 * `cid_verified`/`digest_match` only prove the bytes are the ones committed to, not that
 * anything they say is true.
 */
export const tokenMetadata = pgTable(
  "token_metadata",
  {
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    uri: text("uri").notNull(),
    /** "pending" | "ok" | "not_json" | "invalid" | "too_large" | "unavailable" | "not_found" | "blocked" | "unsupported_uri" | "integrity_mismatch" */
    status: text("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(0),
    normalizedUrl: text("normalized_url"),
    gateway: text("gateway"),
    httpStatus: integer("http_status"),
    contentType: text("content_type"),
    bytes: integer("bytes"),
    keccak256: hash("keccak256"),
    sha256: hash("sha256"),
    /** Bytes hash to the CID in the URI (raw-codec sha2-256 CIDs only). null = not checkable. */
    cidVerified: boolean("cid_verified"),
    onchainDigest: hash("onchain_digest"),
    /** keccak256(bytes) equals the digest in the launch event. null = no onchain digest. */
    digestMatch: boolean("digest_match"),
    data: jsonb("data"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.tokenAddress] }), index("token_metadata_queue_idx").on(t.chainId, t.status, t.priority, t.nextAttemptAt)],
);

/** Indexer heartbeat per chain, readable by /api/health from any process. */
export const indexerStatus = pgTable("indexer_status", {
  chainId: integer("chain_id").primaryKey(),
  network: text("network").notNull(),
  /** "running" | "idle" | "error" */
  state: text("state").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastLaunchDiscoveryAt: timestamp("last_launch_discovery_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  lastBackfillAt: timestamp("last_backfill_at", { withTimezone: true }),
  lastReorgAt: timestamp("last_reorg_at", { withTimezone: true }),
  headBlock: bigint("head_block", { mode: "bigint" }),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  provider: jsonb("provider"),
  stats: jsonb("stats"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shareLinks = pgTable(
  "share_links",
  {
    id: varchar("id", { length: 16 }).primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("share_token_uq").on(t.chainId, t.tokenAddress)],
);

export const authNonces = pgTable("auth_nonces", {
  nonce: varchar("nonce", { length: 64 }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/** Append-only execution receipts, independent of process-local telemetry. */
export const indexerRuns = pgTable(
  "indexer_runs",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull(),
    report: jsonb("report").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("indexer_runs_time_idx").on(t.createdAt)],
);

export const operationalAlerts = pgTable("operational_alerts", {
  key: text("key").primaryKey(),
  state: jsonb("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Canonical bytes are immutable; historical submissions survive proof updates. */
export const proofDocuments = pgTable(
  "proof_documents",
  {
    hash: hash("hash").primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    creatorAddress: addr("creator_address").notNull(),
    canonical: text("canonical").notNull(),
    uri: text("uri").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("proof_documents_history_idx").on(t.chainId, t.tokenAddress, t.createdAt)],
);

export const ownershipChallenges = pgTable(
  "ownership_challenges",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    creatorAddress: addr("creator_address").notNull(),
    kind: text("kind").notNull(),
    target: text("target").notNull(),
    secretHash: hash("secret_hash").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ownership_challenge_asset_idx").on(t.chainId, t.tokenAddress, t.kind, t.target),
    index("ownership_challenge_expiry_idx").on(t.status, t.validUntil),
  ],
);

export const walletWatchlist = pgTable(
  "wallet_watchlist",
  {
    wallet: addr("wallet").notNull(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.wallet, t.chainId, t.tokenAddress] }), index("watchlist_asset_idx").on(t.chainId, t.tokenAddress)],
);

export const accountPlans = pgTable("account_plans", {
  wallet: addr("wallet").primaryKey(),
  plan: text("plan").notNull().default("free"),
  subscriptionState: text("subscription_state").notNull().default("inactive"),
  providerReference: text("provider_reference"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const usageCounters = pgTable(
  "usage_counters",
  {
    wallet: addr("wallet").notNull(),
    metric: text("metric").notNull(),
    period: text("period").notNull(),
    used: integer("used").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.wallet, t.metric, t.period] })],
);

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: text("id").primaryKey(),
    wallet: addr("wallet").notNull(),
    endpoint: text("endpoint").notNull(),
    /** Shared secret encrypted with WEBHOOK_ENCRYPTION_KEY (AES-256-GCM). */
    encryptedSecret: text("encrypted_secret").notNull(),
    filters: jsonb("filters").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhooks_wallet_idx").on(t.wallet)],
);
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => webhookSubscriptions.id),
    eventKey: text("event_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_delivery_dedupe_uq").on(t.subscriptionId, t.eventKey), index("webhook_delivery_queue_idx").on(t.status, t.nextAttemptAt)],
);

export const revokedSessions = pgTable("revoked_sessions", {
  hash: text("hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const developerKeys = pgTable(
  "developer_keys",
  {
    hash: text("hash").primaryKey(),
    wallet: addr("wallet").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("developer_keys_wallet_idx").on(t.wallet)],
);

export const contractObservations = pgTable(
  "contract_observations",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: hash("block_hash").notNull(),
    analysis: jsonb("analysis").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contract_observations_block_uq").on(t.chainId, t.tokenAddress, t.blockHash),
    index("contract_observations_history_idx").on(t.chainId, t.tokenAddress, t.observedAt),
  ],
);

/** Persist monitoring baselines across serverless process restarts. */
export const monitoringSamples = pgTable(
  "monitoring_samples",
  {
    chainId: integer("chain_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    metrics: jsonb("metrics").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.observedAt] })],
);
/** Condition transitions and queued deliveries commit together; send outside row locks. */
export const operationalAlertDeliveries = pgTable(
  "operational_alert_deliveries",
  {
    id: text("id").primaryKey(),
    sequence: serial("sequence").notNull().unique(),
    alertKey: text("alert_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: text("lease_token"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("operational_delivery_due_idx").on(t.status, t.nextAttemptAt), index("operational_delivery_order_idx").on(t.alertKey, t.sequence)],
);

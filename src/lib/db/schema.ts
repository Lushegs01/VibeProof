import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Conventions
 *  - Addresses are stored lowercase (varchar 42). Display layer checksums them.
 *  - Token amounts are numeric(78,0) (uint256-safe), never float.
 *  - Nullable metric columns mean "unknown", never zero.
 */
const addr = (name: string) => varchar(name, { length: 42 });
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
    /**
     * true once the indexer holds this token's COMPLETE event history (from its creation block),
     * either because it launched after the activity start block or via per-token backfill.
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tokens_chain_address_uq").on(t.chainId, t.address),
    index("tokens_creator_idx").on(t.creatorAddress),
    index("tokens_symbol_idx").on(t.symbol),
    index("tokens_created_idx").on(t.createdAt),
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
    launchId: uint("launch_id"),
    curveAddress: addr("curve_address"),
    pairCurrency: addr("pair_currency"),
    txHash: varchar("tx_hash", { length: 66 }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    graduatedAt: timestamp("graduated_at", { withTimezone: true }),
    /** "bonding" | "graduated" | "unknown" — only set from observed events. */
    status: text("status").notNull().default("bonding"),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("launches_chain_token_uq").on(t.chainId, t.tokenAddress),
    index("launches_creator_idx").on(t.creatorAddress),
    index("launches_curve_idx").on(t.curveAddress),
    index("launches_created_idx").on(t.createdAt),
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
  (t) => [primaryKey({ columns: [t.chainId, t.tokenAddress, t.walletAddress] }), index("holders_wallet_idx").on(t.walletAddress)],
);

export const transactionEvents = pgTable(
  "transaction_events",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    txHash: varchar("tx_hash", { length: 66 }).notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    tokenAddress: addr("token_address").notNull(),
    walletAddress: addr("wallet_address"),
    counterparty: addr("counterparty"),
    /** "launch" | "transfer" | "buy" | "sell" | "graduation" */
    eventType: text("event_type").notNull(),
    amount: uint("amount"),
    /** Native / pair-currency amount for buys & sells. */
    quoteAmount: uint("quote_amount"),
  },
  (t) => [
    uniqueIndex("tx_events_uq").on(t.chainId, t.txHash, t.logIndex),
    index("tx_events_token_time_idx").on(t.tokenAddress, t.timestamp),
    index("tx_events_wallet_idx").on(t.walletAddress),
    index("tx_events_time_idx").on(t.timestamp),
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
    /** "website" | "github" | "demo" | "docs" | ... */
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

/** Ecosystem-wide event feed (derived). */
export const feedEvents = pgTable(
  "feed_events",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: addr("token_address").notNull(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    txHash: varchar("tx_hash", { length: 66 }),
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feed_time_idx").on(t.createdAt), uniqueIndex("feed_dedupe_uq").on(t.chainId, t.kind, t.tokenAddress, t.txHash)],
);

export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tokens launched before the activity start block, queued for a full per-token backfill. */
export const backfillQueue = pgTable("backfill_queue", {
  chainId: integer("chain_id").notNull(),
  tokenAddress: addr("token_address").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  doneAt: timestamp("done_at", { withTimezone: true }),
  error: text("error"),
}, (t) => [primaryKey({ columns: [t.chainId, t.tokenAddress] })]);

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

CREATE TABLE "activity_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"block_number" bigint,
	"holders" integer,
	"transactions" integer,
	"buyers" integer,
	"sellers" integer,
	"volume" numeric(78, 0),
	"graduation_progress" numeric(7, 4),
	"github_pushed_at" timestamp with time zone,
	"creator_tx_count" integer
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" varchar(64) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"launch_count" integer DEFAULT 0 NOT NULL,
	"active_launch_count" integer DEFAULT 0 NOT NULL,
	"graduated_launch_count" integer DEFAULT 0 NOT NULL,
	"historical_launch_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "creators_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "feed_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"tx_hash" varchar(66),
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holders" (
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"balance" numeric(78, 0) NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "holders_chain_id_token_address_wallet_address_pk" PRIMARY KEY("chain_id","token_address","wallet_address")
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"key" text PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launches" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"creator_address" varchar(42) NOT NULL,
	"factory_address" varchar(42) NOT NULL,
	"deployment_id" text NOT NULL,
	"launch_id" numeric(78, 0),
	"curve_address" varchar(42),
	"pair_currency" varchar(42),
	"tx_hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"graduated_at" timestamp with time zone,
	"status" text DEFAULT 'bonding' NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "project_proofs" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"website_url" text,
	"github_url" text,
	"demo_url" text,
	"docs_url" text,
	"twitter_url" text,
	"discord_url" text,
	"description" text,
	"submitted_by" varchar(42) NOT NULL,
	"submitter_is_creator" boolean DEFAULT false NOT NULL,
	"metadata_hash" varchar(66),
	"registry_tx" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"name" text,
	"symbol" text,
	"decimals" integer,
	"total_supply" numeric(78, 0),
	"creator_address" varchar(42),
	"created_at" timestamp with time zone,
	"created_block" bigint,
	"created_tx" varchar(66),
	"verified_contract" boolean,
	"metadata_uri" text,
	"metadata" jsonb,
	"analysis" jsonb,
	"analyzed_at" timestamp with time zone,
	"is_vibe_launch" boolean DEFAULT false NOT NULL,
	"holder_count" integer,
	"transfer_count" integer,
	"buy_count" integer,
	"sell_count" integer,
	"unique_buyers" integer,
	"unique_sellers" integer,
	"volume_wei" numeric(78, 0),
	"last_activity_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"wallet_address" varchar(42),
	"counterparty" varchar(42),
	"event_type" text NOT NULL,
	"amount" numeric(78, 0),
	"quote_amount" numeric(78, 0)
);
--> statement-breakpoint
CREATE TABLE "verification_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"check_type" text NOT NULL,
	"status" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "snapshots_token_time_idx" ON "activity_snapshots" USING btree ("token_address","timestamp");--> statement-breakpoint
CREATE INDEX "feed_time_idx" ON "feed_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_dedupe_uq" ON "feed_events" USING btree ("chain_id","kind","token_address","tx_hash");--> statement-breakpoint
CREATE INDEX "holders_wallet_idx" ON "holders" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "launches_chain_token_uq" ON "launches" USING btree ("chain_id","token_address");--> statement-breakpoint
CREATE INDEX "launches_creator_idx" ON "launches" USING btree ("creator_address");--> statement-breakpoint
CREATE INDEX "launches_curve_idx" ON "launches" USING btree ("curve_address");--> statement-breakpoint
CREATE INDEX "launches_created_idx" ON "launches" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proofs_chain_token_uq" ON "project_proofs" USING btree ("chain_id","token_address");--> statement-breakpoint
CREATE UNIQUE INDEX "share_token_uq" ON "share_links" USING btree ("chain_id","token_address");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_chain_address_uq" ON "tokens" USING btree ("chain_id","address");--> statement-breakpoint
CREATE INDEX "tokens_creator_idx" ON "tokens" USING btree ("creator_address");--> statement-breakpoint
CREATE INDEX "tokens_symbol_idx" ON "tokens" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "tokens_created_idx" ON "tokens" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_events_uq" ON "transaction_events" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "tx_events_token_time_idx" ON "transaction_events" USING btree ("token_address","timestamp");--> statement-breakpoint
CREATE INDEX "tx_events_wallet_idx" ON "transaction_events" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "tx_events_time_idx" ON "transaction_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "checks_token_type_time_idx" ON "verification_checks" USING btree ("token_address","check_type","observed_at");
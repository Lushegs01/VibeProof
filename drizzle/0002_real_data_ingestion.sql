CREATE TABLE "chain_blocks" (
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"parent_hash" varchar(66) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"checkpoint" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_blocks_chain_id_block_number_pk" PRIMARY KEY("chain_id","block_number")
);
--> statement-breakpoint
CREATE TABLE "indexer_status" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"network" text NOT NULL,
	"state" text NOT NULL,
	"started_at" timestamp with time zone,
	"last_tick_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_launch_discovery_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"last_backfill_at" timestamp with time zone,
	"last_reorg_at" timestamp with time zone,
	"head_block" bigint,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"provider" jsonb,
	"stats" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_metadata" (
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"uri" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"normalized_url" text,
	"gateway" text,
	"http_status" integer,
	"content_type" text,
	"bytes" integer,
	"keccak256" varchar(66),
	"sha256" varchar(66),
	"cid_verified" boolean,
	"onchain_digest" varchar(66),
	"digest_match" boolean,
	"data" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"fetched_at" timestamp with time zone,
	"enriched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_metadata_chain_id_token_address_pk" PRIMARY KEY("chain_id","token_address")
);
--> statement-breakpoint
ALTER TABLE "backfill_queue" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "backfill_queue" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "backfill_queue" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "backfill_queue" ADD COLUMN "launch_block" bigint;--> statement-breakpoint
ALTER TABLE "backfill_queue" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "backfill_queue" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backfill_queue" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "backfill_queue" ADD COLUMN "through_block" bigint;--> statement-breakpoint
ALTER TABLE "backfill_queue" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "feed_events" ADD COLUMN "block_number" bigint;--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "launchpad" text DEFAULT 'vibe' NOT NULL;--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "version" text;--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "event_name" text;--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "block_hash" varchar(66);--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "log_index" integer;--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "created_at_exact" boolean;--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "metadata_digest" varchar(66);--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "graduated_tx" varchar(66);--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "graduated_block" bigint;--> statement-breakpoint
ALTER TABLE "launches" ADD COLUMN "curve_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "launchpad" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "token_meta_status" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "token_meta_error" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "token_meta_block" bigint;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "token_meta_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_events" ADD COLUMN "block_hash" varchar(66);--> statement-breakpoint
ALTER TABLE "transaction_events" ADD COLUMN "timestamp_exact" boolean;--> statement-breakpoint
ALTER TABLE "transaction_events" ADD COLUMN "event_name" text;--> statement-breakpoint
CREATE INDEX "chain_blocks_checkpoint_idx" ON "chain_blocks" USING btree ("chain_id","checkpoint","block_number");--> statement-breakpoint
CREATE INDEX "token_metadata_queue_idx" ON "token_metadata" USING btree ("chain_id","status","priority","next_attempt_at");--> statement-breakpoint
CREATE INDEX "backfill_claim_idx" ON "backfill_queue" USING btree ("chain_id","status","priority","launch_block");--> statement-breakpoint
CREATE INDEX "feed_chain_time_idx" ON "feed_events" USING btree ("chain_id","created_at");--> statement-breakpoint
CREATE INDEX "feed_chain_block_idx" ON "feed_events" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE INDEX "holders_token_balance_idx" ON "holders" USING btree ("chain_id","token_address","balance");--> statement-breakpoint
CREATE INDEX "launches_chain_creator_idx" ON "launches" USING btree ("chain_id","creator_address");--> statement-breakpoint
CREATE INDEX "launches_chain_curve_idx" ON "launches" USING btree ("chain_id","curve_address");--> statement-breakpoint
CREATE INDEX "launches_chain_tx_idx" ON "launches" USING btree ("chain_id","tx_hash");--> statement-breakpoint
CREATE INDEX "launches_chain_block_idx" ON "launches" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE INDEX "launches_chain_status_idx" ON "launches" USING btree ("chain_id","status","graduated_at");--> statement-breakpoint
CREATE INDEX "tokens_chain_created_idx" ON "tokens" USING btree ("chain_id","created_at");--> statement-breakpoint
CREATE INDEX "tokens_chain_symbol_lower_idx" ON "tokens" USING btree ("chain_id",lower("symbol") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "tokens_chain_name_lower_idx" ON "tokens" USING btree ("chain_id",lower("name") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "tokens_chain_holders_idx" ON "tokens" USING btree ("chain_id","holder_count");--> statement-breakpoint
CREATE INDEX "tokens_chain_transfers_idx" ON "tokens" USING btree ("chain_id","transfer_count");--> statement-breakpoint
CREATE INDEX "tokens_chain_active_idx" ON "tokens" USING btree ("chain_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "tokens_meta_status_idx" ON "tokens" USING btree ("chain_id","token_meta_status");--> statement-breakpoint
CREATE INDEX "tx_events_chain_token_block_idx" ON "transaction_events" USING btree ("chain_id","token_address","block_number","log_index");--> statement-breakpoint
CREATE INDEX "tx_events_chain_block_idx" ON "transaction_events" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE INDEX "tx_events_chain_type_time_idx" ON "transaction_events" USING btree ("chain_id","event_type","timestamp");--> statement-breakpoint
-- Data migration (non-destructive). Existing backfill rows get explicit statuses.
UPDATE "backfill_queue" SET "status" = 'completed' WHERE "done_at" IS NOT NULL;--> statement-breakpoint
UPDATE "backfill_queue" SET "status" = 'failed', "attempts" = 1 WHERE "done_at" IS NULL AND "error" IS NOT NULL;--> statement-breakpoint
-- Before this migration a v5 CurveCompleted event was recorded as a graduation and no graduation
-- evidence was stored, so a pre-existing "graduated" status cannot be trusted. Mark it unknown
-- and queue the token for a history re-backfill, which re-derives status from stored curve events.
UPDATE "launches" SET "status" = 'unknown' WHERE "status" = 'graduated' AND "graduated_tx" IS NULL;--> statement-breakpoint
DELETE FROM "feed_events" f USING "launches" l WHERE f."kind" = 'graduation' AND l."chain_id" = f."chain_id" AND l."token_address" = f."token_address" AND l."status" = 'unknown';--> statement-breakpoint
UPDATE "tokens" t SET "activity_covered" = false, "holder_count" = NULL, "transfer_count" = NULL, "buy_count" = NULL, "sell_count" = NULL, "unique_buyers" = NULL, "unique_sellers" = NULL, "volume_wei" = NULL, "last_activity_at" = NULL FROM "launches" l WHERE l."chain_id" = t."chain_id" AND l."token_address" = t."address" AND l."status" = 'unknown';--> statement-breakpoint
INSERT INTO "backfill_queue" ("chain_id", "token_address", "status", "reason", "priority", "launch_block")
  SELECT "chain_id", "token_address", 'pending', 'repair', 50, "block_number" FROM "launches" WHERE "status" = 'unknown'
  ON CONFLICT ("chain_id", "token_address") DO UPDATE SET "status" = 'pending', "reason" = 'repair', "priority" = 50, "done_at" = NULL, "attempts" = 0, "next_attempt_at" = NULL, "error" = NULL;--> statement-breakpoint
UPDATE "backfill_queue" q SET "launch_block" = l."block_number" FROM "launches" l WHERE q."launch_block" IS NULL AND l."chain_id" = q."chain_id" AND l."token_address" = q."token_address";--> statement-breakpoint
UPDATE "launches" SET "launchpad" = 'vibe', "version" = split_part("deployment_id", '-', 1) WHERE "version" IS NULL;--> statement-breakpoint
UPDATE "tokens" SET "launchpad" = 'vibe' WHERE "is_vibe_launch" AND "launchpad" IS NULL;

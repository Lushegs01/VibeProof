CREATE TABLE "account_plans" (
	"wallet" varchar(42) PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"subscription_state" text DEFAULT 'inactive' NOT NULL,
	"provider_reference" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"creator_address" varchar(42) NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"secret_hash" varchar(66) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proof_documents" (
	"hash" varchar(66) PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"creator_address" varchar(42) NOT NULL,
	"canonical" text NOT NULL,
	"uri" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"wallet" varchar(42) NOT NULL,
	"metric" text NOT NULL,
	"period" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_wallet_metric_period_pk" PRIMARY KEY("wallet","metric","period")
);
--> statement-breakpoint
CREATE TABLE "wallet_watchlist" (
	"wallet" varchar(42) NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_watchlist_wallet_chain_id_token_address_pk" PRIMARY KEY("wallet","chain_id","token_address")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" varchar(42) NOT NULL,
	"endpoint" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"filters" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_proofs" ADD COLUMN "metadata_uri" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "indexer_runs_time_idx" ON "indexer_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ownership_challenge_asset_idx" ON "ownership_challenges" USING btree ("chain_id","token_address","kind","target");--> statement-breakpoint
CREATE INDEX "ownership_challenge_expiry_idx" ON "ownership_challenges" USING btree ("status","valid_until");--> statement-breakpoint
CREATE INDEX "proof_documents_history_idx" ON "proof_documents" USING btree ("chain_id","token_address","created_at");--> statement-breakpoint
CREATE INDEX "watchlist_asset_idx" ON "wallet_watchlist" USING btree ("chain_id","token_address");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_dedupe_uq" ON "webhook_deliveries" USING btree ("subscription_id","event_key");--> statement-breakpoint
CREATE INDEX "webhook_delivery_queue_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhooks_wallet_idx" ON "webhook_subscriptions" USING btree ("wallet");
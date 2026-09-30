CREATE TABLE "backfill_queue" (
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "backfill_queue_chain_id_token_address_pk" PRIMARY KEY("chain_id","token_address")
);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "activity_covered" boolean DEFAULT false NOT NULL;
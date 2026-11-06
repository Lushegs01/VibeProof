CREATE TABLE "contract_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"analysis" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contract_observations_block_uq" ON "contract_observations" USING btree ("chain_id","token_address","block_hash");--> statement-breakpoint
CREATE INDEX "contract_observations_history_idx" ON "contract_observations" USING btree ("chain_id","token_address","observed_at");
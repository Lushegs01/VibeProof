CREATE TABLE "developer_keys" (
	"hash" text PRIMARY KEY NOT NULL,
	"wallet" varchar(42) NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "developer_keys_wallet_idx" ON "developer_keys" USING btree ("wallet");
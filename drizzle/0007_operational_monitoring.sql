CREATE TABLE "monitoring_samples" (
	"chain_id" integer NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics" jsonb NOT NULL,
	CONSTRAINT "monitoring_samples_chain_id_observed_at_pk" PRIMARY KEY("chain_id","observed_at")
);
--> statement-breakpoint
CREATE TABLE "operational_alert_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence" serial NOT NULL,
	"alert_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_alert_deliveries_sequence_unique" UNIQUE("sequence")
);
--> statement-breakpoint
CREATE INDEX "operational_delivery_due_idx" ON "operational_alert_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "operational_delivery_order_idx" ON "operational_alert_deliveries" USING btree ("alert_key","sequence");
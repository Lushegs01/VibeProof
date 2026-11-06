CREATE TABLE "revoked_sessions" (
	"hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);

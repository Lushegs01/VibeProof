import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __vpDb?: DB; __vpSql?: postgres.Sql };

/**
 * Connection string. DATABASE_URL wins; POSTGRES_URL is what Vercel's Postgres/Neon
 * integrations inject, so it is accepted as a fallback.
 */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

/** Returns null when no database is configured so the app can still serve live, uncached reads. */
export function getDb(): DB | null {
  const url = databaseUrl();
  if (!url) return null;
  if (!g.__vpDb) {
    // Serverless: many short-lived instances → keep each pool small.
    const serverless = !!process.env.VERCEL;
    // Transaction-mode poolers (PgBouncer, Neon "-pooler" hosts) don't support named prepared statements.
    const pooled = /-pooler\.|pgbouncer=true|:6543\//.test(url) || process.env.DB_PREPARE === "false";
    g.__vpSql = postgres(url, {
      max: Number(process.env.DB_POOL_MAX ?? (serverless ? 3 : 10)),
      prepare: !pooled,
      idle_timeout: serverless ? 10 : 30,
      connect_timeout: 15,
    });
    g.__vpDb = drizzle(g.__vpSql, { schema });
  }
  return g.__vpDb;
}

export function getSql() {
  getDb();
  return g.__vpSql ?? null;
}

export { schema };

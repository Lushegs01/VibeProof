import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __vpDb?: DB; __vpSql?: postgres.Sql };

/** Returns null when DATABASE_URL is unset so the app can still serve live, uncached reads. */
export function getDb(): DB | null {
  if (!process.env.DATABASE_URL) return null;
  if (!g.__vpDb) {
    g.__vpSql = postgres(process.env.DATABASE_URL, { max: Number(process.env.DB_POOL_MAX ?? 10), prepare: true, idle_timeout: 30 });
    g.__vpDb = drizzle(g.__vpSql, { schema });
  }
  return g.__vpDb;
}

export function getSql() {
  getDb();
  return g.__vpSql ?? null;
}

export { schema };

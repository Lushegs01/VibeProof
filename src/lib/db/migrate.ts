import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb, getSql } from "./client";

/**
 * `tsx src/lib/db/migrate.ts`                 → fails if no database is configured
 * `tsx src/lib/db/migrate.ts --if-configured` → skips cleanly (used by `vercel-build`,
 *                                               so builds without a database still succeed)
 */
const optional = process.argv.includes("--if-configured");
const db = getDb();
if (!db) {
  if (optional) {
    console.log("migrate: no DATABASE_URL/POSTGRES_URL configured, skipping");
    process.exit(0);
  }
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("migrations applied");
await getSql()?.end();

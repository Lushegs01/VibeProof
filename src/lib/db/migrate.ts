import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb, getSql } from "./client";

const db = getDb();
if (!db) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("migrations applied");
await getSql()?.end();

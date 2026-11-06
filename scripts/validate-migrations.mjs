import { readFile, readdir } from "node:fs/promises";
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
let last = -1;
for (const [i, e] of journal.entries.entries()) {
  if (e.idx !== i || e.when <= last) throw new Error("Migration journal ordering invalid");
  last = e.when;
  await readFile(`drizzle/${e.tag}.sql`, "utf8");
}
const migrations = (await readdir("drizzle")).filter((f) => f.endsWith(".sql"));
if (migrations.length !== journal.entries.length) throw new Error("Unregistered or missing migration");
console.log(`${migrations.length} versioned migrations registered; PostgreSQL integration tests verify execution and repeatability.`);

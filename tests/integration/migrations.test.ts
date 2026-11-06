import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { describe, expect, it } from "vitest";

/** Upgrade real 0002-era rows, not just an empty database or an already-migrated schema. */
describe.runIf(process.env.SKIP_DB_TESTS !== "1")("legacy database upgrade", () => {
  it("preserves tokens and proof commitments through all additive migrations", async () => {
    const base = new URL(process.env.DATABASE_URL_TEST ?? "postgres://postgres@127.0.0.1:5432/vibeproof_test");
    if (!base.pathname.endsWith("_test")) throw new Error("Migration test requires a disposable *_test database");
    const database = `vp_upgrade_${randomBytes(8).toString("hex")}_test`;
    const admin = postgres(base.href, { max: 1, onnotice: () => {} });
    const folder = await mkdtemp(join(tmpdir(), "vp-migrations-"));
    let connection: postgres.Sql | undefined;
    try {
      // database is generated exclusively from the fixed prefix plus random hexadecimal bytes.
      await admin.unsafe(`create database ${database}`);
      base.pathname = `/${database}`;
      connection = postgres(base.href, { max: 1, onnotice: () => {} });
      const db = drizzle(connection);
      const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
      await mkdir(join(folder, "meta"));
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 3) }));
      for (const entry of journal.entries.slice(0, 3)) await copyFile(`drizzle/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
      await migrate(db, { migrationsFolder: folder });
      const token = `0x${"a".repeat(40)}`,
        creator = `0x${"b".repeat(40)}`,
        hash = `0x${"c".repeat(64)}`;
      await connection`insert into tokens(chain_id,address,name) values(46630,${token},'preserved before upgrade')`;
      await connection`insert into project_proofs(chain_id,token_address,submitted_by,metadata_hash) values(46630,${token},${creator},${hash})`;
      await migrate(db, { migrationsFolder: "./drizzle" });
      await migrate(db, { migrationsFolder: "./drizzle" });
      const [legacy] =
        await connection`select t.name,p.metadata_hash,p.metadata_uri from tokens t join project_proofs p on p.chain_id=t.chain_id and p.token_address=t.address`;
      expect(legacy).toMatchObject({ name: "preserved before upgrade", metadata_hash: hash, metadata_uri: null });
      const [tables] =
        await connection`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name in ('proof_documents','wallet_watchlist','webhook_deliveries','contract_observations','monitoring_samples','operational_alert_deliveries')`;
      expect(tables.n).toBe(6);
    } finally {
      await connection?.end();
      await admin.unsafe(`drop database if exists ${database}`);
      await admin.end();
      await rm(folder, { recursive: true, force: true });
    }
  }, 60_000);
});

import path from "node:path";
import { readFile } from "node:fs/promises";
import { readMigrations, migrationSetSha256 } from "../src/database/migrator.js";

const migrations = await readMigrations(path.join(process.cwd(), "database", "migrations"));
const protocol = JSON.parse(await readFile(path.join(process.cwd(), "contracts", "manifest.json"), "utf8")) as { schemaVersion: number; schemaSha256: string; typesSha256: string };

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  protocol,
  migrations: {
    count: migrations.length,
    setSha256: migrationSetSha256(migrations),
    files: migrations.map(({ id, checksum }) => ({ id, checksum })),
  },
}, null, 2)}\n`);

import { Client } from "pg";
import path from "node:path";
import { applyMigrations, readMigrations } from "./migrator.js";

const databaseUrl = process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATIONS_DATABASE_URL or DATABASE_URL is required to run migrations.");

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const migrations = await readMigrations(path.join(process.cwd(), "database", "migrations"));
  await applyMigrations(client, migrations);
  console.log(`Applied ${migrations.length} known migration(s).`);
} finally {
  await client.end();
}

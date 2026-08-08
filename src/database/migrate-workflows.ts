import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { migrateLegacyWorkflow } from "../workflow/workflow-migration.js";

interface LegacyRow { workflow_id: string; version: number; definition: unknown }
interface MigrationReportItem { workflowId: string; version: number; status: "ready" | "migrated" | "invalid"; checksum?: string; errors?: string[] }

const apply = process.argv.includes("--apply");
const reportArgument = process.argv.find((argument) => argument.startsWith("--report="));
const reportPath = reportArgument?.slice("--report=".length);
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = Number.parseInt(limitArgument?.slice("--limit=".length) ?? "1000", 10);
if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error("--limit must be between 1 and 10000.");

const databaseUrl = process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATIONS_DATABASE_URL or DATABASE_URL is required.");
const client = new Client({ connectionString: databaseUrl });
await client.connect();

const report: MigrationReportItem[] = [];
try {
  const rows = await client.query<LegacyRow>(
    "SELECT workflow_id, version, definition FROM workflow_versions WHERE COALESCE(definition->>'format', '') <> 'doonce.workflow-spec.v1' ORDER BY workflow_id, version LIMIT $1",
    [limit],
  );
  if (apply) await client.query("BEGIN");
  try {
    for (const row of rows.rows) {
      const migrated = migrateLegacyWorkflow(row.definition);
      if (!migrated.ok) {
        report.push({ workflowId: row.workflow_id, version: row.version, status: "invalid", errors: migrated.errors });
        continue;
      }
      if (apply) {
        await client.query("UPDATE workflow_versions SET definition = $1::jsonb, schema_version = 1, source = 'legacy-v0-migration' WHERE workflow_id = $2 AND version = $3", [JSON.stringify(migrated.value), row.workflow_id, row.version]);
      }
      report.push({ workflowId: row.workflow_id, version: row.version, status: apply ? "migrated" : "ready", checksum: migrated.checksum });
    }
    if (apply) await client.query("COMMIT");
  } catch (error) {
    if (apply) await client.query("ROLLBACK");
    throw error;
  }
} finally {
  await client.end();
}

const output = { mode: apply ? "apply" : "dry-run", generatedAt: new Date().toISOString(), scanned: report.length, ready: report.filter((item) => item.status !== "invalid").length, invalid: report.filter((item) => item.status === "invalid").length, items: report };
if (reportPath) await writeFile(path.resolve(reportPath), `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

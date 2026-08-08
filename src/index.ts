import { buildServer } from "./server.js";
import { AuthService } from "./auth/auth-service.js";
import { PostgresAuthStore } from "./auth/postgres-auth-store.js";
import { PostgresWorkflowStore } from "./workflow/postgres-workflow-store.js";
import { CanonicalWorkflowService } from "./workflow/canonical-workflow-service.js";
import { PostgresCanonicalWorkflowStore } from "./workflow/postgres-canonical-workflow-store.js";
import { WorkflowService } from "./workflow/workflow-service.js";
import { PostgresRunReceiptStore } from "./runner/postgres-run-receipt-store.js";
import { PostgresSupportReportStore } from "./support/postgres-support-report-store.js";
import { assertRuntimeDatabaseRole } from "./database/runtime-role.js";
import { Pool } from "pg";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;
if (databaseUrl && !sessionSecret) throw new Error("SESSION_SECRET is required when DATABASE_URL is configured.");

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;
if (pool) await assertRuntimeDatabaseRole(pool);
const runReceiptStore = pool && sessionSecret ? new PostgresRunReceiptStore(pool) : undefined;
const app = await buildServer({
  ...(pool && sessionSecret ? { authService: new AuthService(new PostgresAuthStore(pool), sessionSecret) } : {}),
  ...(pool && runReceiptStore ? { workflowService: new WorkflowService(new PostgresWorkflowStore(pool), runReceiptStore) } : {}),
  ...(pool ? { canonicalWorkflowService: new CanonicalWorkflowService(new PostgresCanonicalWorkflowStore(pool)) } : {}),
  ...(runReceiptStore ? { runReceiptStore } : {}),
  ...(pool && sessionSecret ? { supportReportStore: new PostgresSupportReportStore(pool) } : {}),
});
if (pool) app.addHook("onClose", async () => pool.end());

void app.listen({ host, port });

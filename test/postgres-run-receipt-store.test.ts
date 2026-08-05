import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { PostgresRunReceiptStore, ReceiptAlreadyImportedError } from "../src/runner/postgres-run-receipt-store.js";
import { createRunReceipt } from "../src/runner/run-receipt.js";
import { safeReportWorkflowFixture } from "./fixtures/safe-report-workflow.js";

const tenantId = "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
const actorId = "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
const user = { tenantId, userId: actorId } as AuthenticatedUser;

test("refuses a cross-tenant receipt before opening a database connection", async () => {
  let connected = false;
  const store = new PostgresRunReceiptStore({
    connect: async () => {
      connected = true;
      throw new Error("database should not be reached");
    },
  } as unknown as Pool);
  const receipt = createRunReceipt({
    tenantId: "d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
    workflowId: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
    workflowVersion: 1,
    actorId,
    outcome: "completed",
    stepOutcomes: [{ stepId: "step-1", outcome: "verified" }],
    startedAt: "2026-08-05T00:00:00.000Z",
  });

  await assert.rejects(() => store.save(receipt, user), /Receipt identity/);
  assert.equal(connected, false);
});

test("maps a receipt uniqueness violation to a safe duplicate-import error", async () => {
  const queries: string[] = [];
  let released = false;
  const store = new PostgresRunReceiptStore({
    connect: async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith("SELECT version")) return { rows: [{ version: 1, definition: { ...safeReportWorkflowFixture, allowedDomains: ["localhost"], steps: safeReportWorkflowFixture.steps.map((step) => ({ ...step, domain: "localhost", path: "/demo/reports" })) } }] };
        if (sql.startsWith("INSERT INTO workflow_run_receipts")) throw Object.assign(new Error("unique constraint"), { code: "23505" });
        return { rows: [] };
      },
      release: () => { released = true; },
    }),
  } as unknown as Pool);

  await assert.rejects(
    () => store.importLocalDemoReceipt("a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", { sourceId: "d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", outcome: "completed" }, user),
    ReceiptAlreadyImportedError,
  );
  assert.ok(queries.includes("ROLLBACK"));
  assert.equal(released, true);
});

test("loads only the newest bounded receipt history", async () => {
  const queries: string[] = [];
  const store = new PostgresRunReceiptStore({
    connect: async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith("SELECT id, tenant_id")) return { rows: [] };
        return { rows: [] };
      },
      release: () => undefined,
    }),
  } as unknown as Pool);

  assert.deepEqual(await store.listLocalDemoReceipts("a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", user), []);
  assert.ok(queries.some((sql) => sql.includes("ORDER BY finished_at DESC LIMIT 50")));
});

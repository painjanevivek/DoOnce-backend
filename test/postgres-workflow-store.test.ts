import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { PostgresWorkflowStore } from "../src/workflow/postgres-workflow-store.js";

const user = {
  tenantId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  userId: "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
} as AuthenticatedUser;

test("lists resumable draft versions without returning draft definitions", async () => {
  const queries: string[] = [];
  const store = new PostgresWorkflowStore({
    connect: async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith("SELECT workflows.id")) {
          return {
            rows: [{
              id: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
              title: "Download weekly sales report",
              active_version: 1,
              draft_version: 2,
              updated_at: new Date("2026-08-05T00:00:00.000Z"),
            }],
          };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
  } as unknown as Pool);

  assert.deepEqual(await store.listWorkflows(user), [{
    id: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
    title: "Download weekly sales report",
    activeVersion: 1,
    draftVersion: 2,
    updatedAt: "2026-08-05T00:00:00.000Z",
  }]);
  const listQuery = queries.find((sql) => sql.startsWith("SELECT workflows.id"));
  assert.ok(listQuery?.includes("LEFT JOIN LATERAL"));
  assert.equal(listQuery?.includes("definition"), false);
});

test("scopes an emergency disable to the authenticated tenant in SQL", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresWorkflowStore({
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        return sql.startsWith("UPDATE workflow_versions") ? { rows: [{ version: 4 }] } : { rows: [] };
      },
      release: () => undefined,
    }),
  } as unknown as Pool);

  assert.equal(await store.disableActive("a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", user), 4);
  const disableQuery = queries.find(({ sql }) => sql.startsWith("UPDATE workflow_versions"));
  assert.ok(disableQuery?.sql.includes("tenant_id = $2"));
  assert.deepEqual(disableQuery?.values, ["a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", user.tenantId]);
});

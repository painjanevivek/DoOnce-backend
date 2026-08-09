import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { PostgresCaptureStore } from "../src/capture/postgres-capture-store.js";
import type { CaptureSyncRequest } from "../src/contracts/protocol.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";

const user = { tenantId: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", userId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", role: "owner" } as AuthenticatedUser;

test("stores one capture batch with a locked cursor and one bulk action insert", async () => {
  const request = validProtocolFixtures.CaptureSyncRequest as CaptureSyncRequest;
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresCaptureStore({
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (sql.startsWith("SELECT accepted_through, status FROM capture_batches")) return { rows: [] };
        if (sql.startsWith("SELECT accepted_through, status FROM capture_sessions")) return { rows: [{ accepted_through: -1, status: "recording" }] };
        return { rows: [] };
      },
      release: () => undefined,
    }),
  } as unknown as Pool);

  const ack = await store.syncBatch(user, request);

  assert.equal(ack.acceptedThrough, 0);
  assert.ok(queries.some(({ sql }) => sql.includes("FOR UPDATE")));
  assert.equal(queries.filter(({ sql }) => sql.startsWith("INSERT INTO capture_actions")).length, 1);
  assert.ok(queries.some(({ sql, values }) => sql.includes("set_config('app.tenant_id'") && values?.[0] === user.tenantId));
});

test("acknowledges a retried batch without inserting its actions twice", async () => {
  const request = validProtocolFixtures.CaptureSyncRequest as CaptureSyncRequest;
  const queries: string[] = [];
  const store = new PostgresCaptureStore({
    connect: async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith("SELECT accepted_through, status FROM capture_batches")) {
          return { rows: [{ accepted_through: 0, status: "accepted" }] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
  } as unknown as Pool);

  const ack = await store.syncBatch(user, request);

  assert.equal(ack.status, "duplicate");
  assert.equal(ack.acceptedThrough, 0);
  assert.equal(queries.some((sql) => sql.startsWith("INSERT INTO capture_actions")), false);
});

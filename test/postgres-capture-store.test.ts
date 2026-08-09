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
        if (sql.startsWith("SELECT accepted_through, status, approved_origins FROM capture_sessions")) return { rows: [{ accepted_through: -1, status: "recording", approved_origins: [] }] };
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

test("reloads a tenant capture as an ordered compiler input", async () => {
  const request = validProtocolFixtures.CaptureSyncRequest as CaptureSyncRequest;
  const queries: string[] = [];
  const store = new PostgresCaptureStore({
    connect: async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith("SELECT id, status")) return { rows: [{ id: request.sessionId, status: "finalized", approved_origins: ["https://reports.example.test"], accepted_through: 0, created_at: "2026-08-09T00:00:00.000Z", updated_at: "2026-08-09T00:00:01.000Z", finalized_at: "2026-08-09T00:00:01.000Z" }] };
        if (sql.startsWith("SELECT action")) return { rows: request.actions.map((action) => ({ action })) };
        return { rows: [] };
      },
      release: () => undefined,
    }),
  } as unknown as Pool);

  const session = await store.findSession(user, request.sessionId);

  assert.equal(session?.status, "finalized");
  assert.equal(session?.actions[0]?.id, request.actions[0]?.id);
  assert.equal(session?.syncCursor, 0);
  assert.ok(queries.some((sql) => sql.includes("ORDER BY sequence")));
});

test("lists bounded recent capture summaries with compiled draft references", async () => {
  const request = validProtocolFixtures.CaptureSyncRequest as CaptureSyncRequest;
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresCaptureStore({
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (sql.startsWith("SELECT sessions.id")) return { rows: [{ id: request.sessionId, status: "finalized", created_at: "2026-08-09T00:00:00.000Z", finalized_at: "2026-08-09T00:00:01.000Z", action_count: 1, workflow_id: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", compiler_version: "1.0.0" }] };
        return { rows: [] };
      },
      release: () => undefined,
    }),
  } as unknown as Pool);

  const summaries = await store.listSessions(user, 20);

  assert.equal(summaries[0]?.actionCount, 1);
  assert.equal(summaries[0]?.compilerVersion, "1.0.0");
  const listQuery = queries.find(({ sql }) => sql.startsWith("SELECT sessions.id"));
  assert.equal(listQuery?.values?.[0], 20);
  assert.ok(listQuery?.sql.includes("source_capture_session_id"));
});

test("enforces total action and origin bounds across synchronization batches", async () => {
  const base = validProtocolFixtures.CaptureSyncRequest as CaptureSyncRequest;
  const query = async (sql: string) => {
    if (sql.startsWith("SELECT accepted_through, status FROM capture_batches")) return { rows: [] };
    if (sql.startsWith("SELECT accepted_through, status, approved_origins")) return { rows: [{ accepted_through: 999, status: "recording", approved_origins: Array.from({ length: 20 }, (_, index) => `https://origin-${index}.example.test`) }] };
    return { rows: [] };
  };
  const store = new PostgresCaptureStore({ connect: async () => ({ query, release: () => undefined }) } as unknown as Pool);
  const overLimit = { ...base, cursor: 999, actions: [{ ...base.actions[0]!, sequence: 1000, origin: "https://new-origin.example.test" }] };

  await assert.rejects(() => store.syncBatch(user, overLimit), /1,000 actions/);

  const originStore = new PostgresCaptureStore({
    connect: async () => ({
      query: async (sql: string) => {
        if (sql.startsWith("SELECT accepted_through, status FROM capture_batches")) return { rows: [] };
        if (sql.startsWith("SELECT accepted_through, status, approved_origins")) return { rows: [{ accepted_through: 0, status: "recording", approved_origins: Array.from({ length: 20 }, (_, index) => `https://origin-${index}.example.test`) }] };
        return { rows: [] };
      },
      release: () => undefined,
    }),
  } as unknown as Pool);
  const newOrigin = { ...base, cursor: 0, actions: [{ ...base.actions[0]!, sequence: 1, origin: "https://new-origin.example.test" }] };
  await assert.rejects(() => originStore.syncBatch(user, newOrigin), /20 browser origins/);
});

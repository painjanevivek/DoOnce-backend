import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { PostgresRunReceiptStore } from "../src/runner/postgres-run-receipt-store.js";
import { createRunReceipt } from "../src/runner/run-receipt.js";

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

import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import { validateWorkflowDraft, type WorkflowDraft } from "../workflow/schema.js";
import type { RunReceipt, RunReceiptOutcome } from "./run-receipt.js";

export interface LocalDemoReceiptImport {
  sourceId: string;
  outcome: Extract<RunReceiptOutcome, "completed" | "paused">;
  pauseReason?: string;
}

export interface LocalDemoReceiptStore {
  importLocalDemoReceipt(workflowId: string, input: LocalDemoReceiptImport, user: AuthenticatedUser): Promise<RunReceipt | undefined>;
}

export class PostgresRunReceiptStore implements LocalDemoReceiptStore {
  public constructor(private readonly pool: Pool) {}

  public async save(receipt: RunReceipt, user: AuthenticatedUser): Promise<void> {
    if (receipt.tenantId !== user.tenantId || receipt.actorId !== user.userId) throw new Error("Receipt identity does not match the authenticated user.");
    const client = await this.pool.connect();
    try {
      await withTenantTransaction(client, user, async (transaction) => {
        await transaction.query(
          "INSERT INTO workflow_run_receipts (id, tenant_id, workflow_id, workflow_version, actor_id, outcome, pause_reason, step_outcomes, started_at, finished_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)",
          [receipt.id, receipt.tenantId, receipt.workflowId, receipt.workflowVersion, receipt.actorId, receipt.outcome, receipt.pauseReason ?? null, JSON.stringify(receipt.stepOutcomes), receipt.startedAt, receipt.finishedAt],
        );
      });
    } finally {
      client.release();
    }
  }

  public async list(workflowId: string, user: AuthenticatedUser): Promise<RunReceipt[]> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{ id: string; tenant_id: string; workflow_id: string; workflow_version: number; actor_id: string; outcome: RunReceipt["outcome"]; pause_reason: string | null; step_outcomes: RunReceipt["stepOutcomes"]; started_at: Date; finished_at: Date }>(
          "SELECT id, tenant_id, workflow_id, workflow_version, actor_id, outcome, pause_reason, step_outcomes, started_at, finished_at FROM workflow_run_receipts WHERE workflow_id = $1 ORDER BY finished_at DESC",
          [workflowId],
        );
        return result.rows.map((row) => ({ id: row.id, tenantId: row.tenant_id, workflowId: row.workflow_id, workflowVersion: row.workflow_version, actorId: row.actor_id, outcome: row.outcome, ...(row.pause_reason ? { pauseReason: row.pause_reason } : {}), stepOutcomes: row.step_outcomes, startedAt: row.started_at.toISOString(), finishedAt: row.finished_at.toISOString() }));
      });
    } finally {
      client.release();
    }
  }

  public async importLocalDemoReceipt(workflowId: string, input: LocalDemoReceiptImport, user: AuthenticatedUser): Promise<RunReceipt | undefined> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const active = await transaction.query<{ version: number; definition: WorkflowDraft }>(
          "SELECT version, definition FROM workflow_versions WHERE workflow_id = $1 AND status = 'active'",
          [workflowId],
        );
        const workflow = active.rows[0];
        const validation = workflow && validateWorkflowDraft(workflow.definition);
        if (!workflow || !validation?.ok || !isSupportedLocalDemo(validation.value)) return undefined;
        const finishedAt = new Date().toISOString();
        const receipt: RunReceipt = {
          id: input.sourceId,
          tenantId: user.tenantId,
          workflowId,
          workflowVersion: workflow.version,
          actorId: user.userId,
          outcome: input.outcome,
          ...(input.pauseReason ? { pauseReason: input.pauseReason } : {}),
          stepOutcomes: validation.value.steps.map((step) => ({ stepId: step.id, outcome: input.outcome === "completed" ? "verified" : "paused" })),
          startedAt: finishedAt,
          finishedAt,
        };
        await transaction.query(
          "INSERT INTO workflow_run_receipts (id, tenant_id, workflow_id, workflow_version, actor_id, outcome, pause_reason, step_outcomes, started_at, finished_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)",
          [receipt.id, receipt.tenantId, receipt.workflowId, receipt.workflowVersion, receipt.actorId, receipt.outcome, receipt.pauseReason ?? null, JSON.stringify(receipt.stepOutcomes), receipt.startedAt, receipt.finishedAt],
        );
        return receipt;
      });
    } finally {
      client.release();
    }
  }
}

function isSupportedLocalDemo(workflow: WorkflowDraft): boolean {
  return workflow.steps.length > 0 && workflow.steps.every((step) => step.kind === "download" && ["localhost", "127.0.0.1"].includes(step.domain) && step.path === "/demo/reports");
}

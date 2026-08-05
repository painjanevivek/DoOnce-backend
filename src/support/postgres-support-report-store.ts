import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";

export const supportReportCategories = ["workflow-paused", "unexpected-result", "safety-concern", "other"] as const;
export type SupportReportCategory = (typeof supportReportCategories)[number];

export interface SubmittedSupportReport {
  id: string;
  category: SupportReportCategory;
  createdAt: string;
}

export interface SupportReportStore {
  submit(category: SupportReportCategory, user: AuthenticatedUser): Promise<SubmittedSupportReport>;
}

export class PostgresSupportReportStore implements SupportReportStore {
  public constructor(private readonly pool: Pool) {}

  public async submit(category: SupportReportCategory, user: AuthenticatedUser): Promise<SubmittedSupportReport> {
    const client = await this.pool.connect();
    const id = randomUUID();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{ created_at: Date }>(
          "INSERT INTO support_reports (id, tenant_id, reporter_id, category) VALUES ($1, $2, $3, $4) RETURNING created_at",
          [id, user.tenantId, user.userId, category],
        );
        const createdAt = result.rows[0]?.created_at;
        if (!createdAt) throw new Error("Support report was not stored.");
        return { id, category, createdAt: createdAt.toISOString() };
      });
    } finally {
      client.release();
    }
  }
}

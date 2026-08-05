import type { SqlClient } from "./migrator.js";

export interface TenantContext {
  tenantId: string;
  userId: string;
}

export async function withTenantTransaction<T>(
  client: SqlClient,
  context: TenantContext,
  work: (transaction: SqlClient) => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [context.tenantId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [context.userId]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

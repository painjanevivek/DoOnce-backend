import type { SqlClient } from "./migrator.js";

export async function assertRuntimeDatabaseRole(client: SqlClient): Promise<void> {
  const result = await client.query<{ is_superuser: boolean; bypasses_rls: boolean }>(
    "SELECT rolsuper AS is_superuser, rolbypassrls AS bypasses_rls FROM pg_roles WHERE rolname = current_user",
  );
  const role = result.rows[0];
  if (!role || role.is_superuser || role.bypasses_rls) {
    throw new Error("DATABASE_URL must use a non-superuser role without BYPASSRLS so tenant row-level security remains effective.");
  }
}

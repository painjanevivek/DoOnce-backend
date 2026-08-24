import type { SqlClient } from "./migrator.js";
import { migrationSetSha256 } from "./migrator.js";

export async function assertAppliedMigrationSet(client: SqlClient, expectedSha256: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("The expected migration-set checksum is invalid.");
  const applied = await client.query<{ id: string; checksum: string }>("SELECT id, checksum FROM schema_migrations ORDER BY id");
  if (migrationSetSha256(applied.rows) !== expectedSha256) throw new Error("The applied database migration set does not match this release.");
}

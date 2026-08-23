import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { ArtifactMetadata } from "../src/artifacts/artifact-service.js";
import { PostgresArtifactMetadataStore } from "../src/artifacts/postgres-artifact-metadata-store.js";

const user: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };
const artifact: ArtifactMetadata = {
  id: "33333333-3333-4333-8333-333333333333",
  runId: "44444444-4444-4444-8444-444444444444",
  stepId: "55555555-5555-4555-8555-555555555555",
  retentionClass: "publication-evidence",
  fileName: "report.csv",
  contentType: "text/csv",
  byteSize: 8,
  checksumSha256: "a".repeat(64),
  storageKey: "tenant/run/artifact",
  createdAt: "2026-08-24T00:00:00.000Z",
  expiresAt: "2027-08-24T00:00:00.000Z",
  pinnedAt: null,
};

test("binds publication artifacts to a leased verified download step", async () => {
  const queries: string[] = [];
  const pool = { connect: async () => ({
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith("INSERT INTO workflow_artifacts")) return { rows: [{ id: artifact.id, run_id: artifact.runId, step_id: artifact.stepId, retention_class: artifact.retentionClass, file_name: artifact.fileName, content_type: artifact.contentType, byte_size: artifact.byteSize, checksum_sha256: artifact.checksumSha256, storage_key: artifact.storageKey, created_at: artifact.createdAt, expires_at: artifact.expiresAt, pinned_at: null }] };
      return { rows: [] };
    },
    release() {},
  }) } as unknown as Pool;

  await new PostgresArtifactMetadataStore(pool).create(user, artifact, "b".repeat(64));

  const insert = queries.find((sql) => sql.startsWith("INSERT INTO workflow_artifacts"));
  assert.match(insert ?? "", /workflow_step_runs executed_step/);
  assert.match(insert ?? "", /executed_step\.status = 'verified'/);
  assert.match(insert ?? "", /declared_step->>'action' = 'download'/);
  assert.match(insert ?? "", /executor_leases leases/);
});

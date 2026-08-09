import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import type { NewVideoImport, VideoImportStore } from "./video-service.js";
import type { DemonstrationTimeline, VideoImport, VideoImportStatus, VideoMetadata } from "./video-types.js";

interface Row extends Record<string, unknown> {
  id: string;
  mode: VideoImport["mode"];
  capture_session_id: string | null;
  file_name: string;
  content_type: VideoImport["contentType"];
  byte_size: number | string;
  uploaded_bytes: number | string;
  checksum_sha256: string | null;
  status: VideoImportStatus;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  frame_rate: number | string | null;
  timeline: DemonstrationTimeline | null;
  workflow_id: string | null;
  error_code: string | null;
  retention_until: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresVideoImportStore implements VideoImportStore {
  public constructor(private readonly pool: Pool) {}

  public create(user: AuthenticatedUser, input: NewVideoImport): Promise<VideoImport> {
    return this.withUser(user, async (db) => {
      const result = await db.query<Row>(
        "INSERT INTO video_imports (id, tenant_id, created_by, mode, capture_session_id, file_name, content_type, byte_size) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [input.id, user.tenantId, user.userId, input.mode, input.captureSessionId ?? null, input.fileName, input.contentType, input.byteSize],
      );
      const row = result.rows[0];
      if (!row) throw new Error("The video import was not created.");
      return map(row);
    });
  }

  public find(user: AuthenticatedUser, id: string): Promise<VideoImport | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<Row>("SELECT * FROM video_imports WHERE id = $1", [id])).rows[0];
      return row ? map(row) : undefined;
    });
  }

  public captureSessionId(user: AuthenticatedUser, id: string): Promise<string | undefined> {
    return this.withUser(user, async (db) => (
      await db.query<{ capture_session_id: string | null }>("SELECT capture_session_id FROM video_imports WHERE id = $1", [id])
    ).rows[0]?.capture_session_id ?? undefined);
  }

  public updateUploaded(user: AuthenticatedUser, id: string, uploadedBytes: number): Promise<VideoImport | undefined> {
    return this.update(user, "UPDATE video_imports SET uploaded_bytes = $2, updated_at = now() WHERE id = $1 AND status = 'uploading' AND uploaded_bytes <= $2 AND $2 <= byte_size RETURNING *", [id, uploadedBytes]);
  }

  public finishUpload(user: AuthenticatedUser, id: string, checksum: string, metadata: VideoMetadata): Promise<VideoImport | undefined> {
    return this.update(user, "UPDATE video_imports SET status='uploaded', checksum_sha256=$2, duration_ms=$3, width=$4, height=$5, frame_rate=$6, updated_at=now() WHERE id=$1 AND status='uploading' AND uploaded_bytes=byte_size RETURNING *", [id, checksum, metadata.durationMs, metadata.width, metadata.height, metadata.frameRate]);
  }

  public setStatus(user: AuthenticatedUser, id: string, status: VideoImportStatus, errorCode?: string): Promise<VideoImport | undefined> {
    return this.update(user, "UPDATE video_imports SET status=$2, error_code=$3, updated_at=now() WHERE id=$1 RETURNING *", [id, status, errorCode ?? null]);
  }

  public saveTimeline(user: AuthenticatedUser, id: string, timeline: DemonstrationTimeline, status: VideoImportStatus): Promise<VideoImport | undefined> {
    return this.update(user, "UPDATE video_imports SET timeline=$2::jsonb, status=$3, updated_at=now() WHERE id=$1 RETURNING *", [id, JSON.stringify(timeline), status]);
  }

  public complete(user: AuthenticatedUser, id: string, workflowId: string, timeline: DemonstrationTimeline): Promise<VideoImport | undefined> {
    return this.update(user, "UPDATE video_imports SET timeline=$2::jsonb, workflow_id=$3, status='completed', updated_at=now() WHERE id=$1 RETURNING *", [id, JSON.stringify(timeline), workflowId]);
  }

  public expired(user: AuthenticatedUser, limit: number): Promise<string[]> {
    return this.withUser(user, async (db) => (
      await db.query<{ id: string }>("SELECT id FROM video_imports WHERE retention_until <= now() ORDER BY retention_until ASC LIMIT $1", [limit])
    ).rows.map(({ id }) => id));
  }

  public delete(user: AuthenticatedUser, id: string): Promise<boolean> {
    return this.withUser(user, async (db) => (await db.query<{ id: string }>("DELETE FROM video_imports WHERE id = $1 RETURNING id", [id])).rows.length === 1);
  }

  private update(user: AuthenticatedUser, sql: string, params: unknown[]): Promise<VideoImport | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<Row>(sql, params)).rows[0];
      return row ? map(row) : undefined;
    });
  }

  private async withUser<T>(user: AuthenticatedUser, work: Parameters<typeof withTenantTransaction<T>>[2]): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, work);
    } finally {
      client.release();
    }
  }
}

function map(row: Row): VideoImport {
  const metadata = row.duration_ms !== null && row.width !== null && row.height !== null && row.frame_rate !== null
    ? { durationMs: row.duration_ms, width: row.width, height: row.height, frameRate: Number(row.frame_rate) }
    : undefined;
  return {
    id: row.id,
    mode: row.mode,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    uploadedBytes: Number(row.uploaded_bytes),
    status: row.status,
    ...(row.checksum_sha256 ? { checksumSha256: row.checksum_sha256 } : {}),
    ...(metadata ? { metadata } : {}),
    ...(row.timeline ? { timeline: row.timeline } : {}),
    ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    retentionUntil: iso(row.retention_until),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

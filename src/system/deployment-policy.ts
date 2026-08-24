import path from "node:path";

const disabledCapabilities = ["TEXT_AUTHORING_ENABLED", "REPAIR_ENABLED", "VIDEO_AUTHORING_ENABLED"] as const;

export function assertProductionMvpEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.NODE_ENV !== "production" || environment.DOONCE_MVP_MODE !== "true") return;
  requireTlsPostgresUrl(environment.DATABASE_URL);
  if (environment.MIGRATIONS_DATABASE_URL) throw new Error("MIGRATIONS_DATABASE_URL must not be present in the API runtime.");
  if (environment.JOB_DATABASE_URL) throw new Error("JOB_DATABASE_URL must be absent while MVP workers are disabled.");
  for (const capability of disabledCapabilities) {
    if (environment[capability] !== "false") throw new Error(`${capability} must explicitly be false in the production MVP.`);
  }
  if (environment.DOONCE_INVITATION_CREATION_ENABLED !== "false") throw new Error("DOONCE_INVITATION_CREATION_ENABLED must explicitly be false in the API runtime.");
  if (environment.DOONCE_KILL_SWITCH !== "false" && environment.DOONCE_KILL_SWITCH !== "true") throw new Error("DOONCE_KILL_SWITCH must be explicitly configured.");

  const sessionSecret = requireIndependentSecret(environment.SESSION_SECRET, "SESSION_SECRET");
  const artifactSecret = requireIndependentSecret(environment.ARTIFACT_SIGNING_SECRET, "ARTIFACT_SIGNING_SECRET");
  const metricsToken = requireIndependentSecret(environment.METRICS_BEARER_TOKEN, "METRICS_BEARER_TOKEN");
  if (new Set([sessionSecret, artifactSecret, metricsToken]).size !== 3) throw new Error("Session, artifact-signing, and metrics credentials must be independent.");

  const artifactPath = environment.ARTIFACT_STORAGE_PATH;
  if (!artifactPath || !path.isAbsolute(artifactPath)) throw new Error("ARTIFACT_STORAGE_PATH must be an absolute persistent mount in the production MVP.");
}

function requireTlsPostgresUrl(value: string | undefined): void {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error("DATABASE_URL must be a valid managed PostgreSQL URL.");
  }
  const sslMode = url.searchParams.get("sslmode");
  if (!(["postgres:", "postgresql:"].includes(url.protocol)) || !url.username || !url.password || !url.hostname || ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || !["require", "verify-full"].includes(sslMode ?? "")) {
    throw new Error("DATABASE_URL must use credentials, a non-loopback PostgreSQL host, and sslmode=require or verify-full.");
  }
}

function requireIndependentSecret(value: string | undefined, variable: string): string {
  if (!value || value.length < 32 || /replace|example|password/i.test(value)) throw new Error(`${variable} must be an independently generated secret of at least 32 characters.`);
  return value;
}

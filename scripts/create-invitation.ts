import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import type { MembershipRole } from "../src/auth/auth-service.js";

const invitationCreationEnabled = process.env.DOONCE_INVITATION_CREATION_ENABLED === "true";
if (!invitationCreationEnabled) throw new Error("Invitation creation is disabled. Set DOONCE_INVITATION_CREATION_ENABLED=true for this operator command only.");

const databaseUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATIONS_DATABASE_URL is required to create invitations.");

const argumentsByName = parseArguments(process.argv.slice(2));
const email = requireEmail(argumentsByName.email);
const role = requireRole(argumentsByName.role ?? "owner");
const issuer = requireIssuer(argumentsByName.issuer);
const expiresInHours = requireExpiry(argumentsByName["expires-hours"] ?? "72");
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const invitationId = randomUUID();
const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [issuer]);
  const recent = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM signup_invitation_audit_events
     WHERE event_type = 'created' AND actor = $1 AND created_at > now() - interval '1 hour'`,
    [issuer],
  );
  if (Number(recent.rows[0]?.count ?? 0) >= 10) throw new Error("Invitation creation rate limit reached for this issuer.");

  const existing = await client.query(
    "SELECT 1 FROM signup_invitations WHERE email = $1 AND consumed_at IS NULL AND expires_at > now() LIMIT 1",
    [email],
  );
  if (existing.rowCount) throw new Error("This email already has an active invitation.");

  await client.query(
    `INSERT INTO signup_invitations (id, email, role, token_hash, issued_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [invitationId, email, role, tokenHash, issuer, expiresAt],
  );
  await client.query(
    `INSERT INTO signup_invitation_audit_events (id, invitation_id, event_type, actor)
     VALUES (gen_random_uuid(), $1, 'created', $2)`,
    [invitationId, issuer],
  );
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

process.stdout.write(`${JSON.stringify({ invitationId, email, role, expiresAt: expiresAt.toISOString(), token }, null, 2)}\n`);

function parseArguments(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("Use --email, --issuer, optional --role, and optional --expires-hours arguments.");
    parsed[key.slice(2)] = value;
  }
  const allowed = new Set(["email", "issuer", "role", "expires-hours"]);
  if (Object.keys(parsed).some((key) => !allowed.has(key))) throw new Error("An unsupported invitation argument was provided.");
  return parsed;
}

function requireEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("--email must be a valid email address.");
  return email;
}

function requireRole(value: string): MembershipRole {
  if (!["owner", "builder", "runner", "reviewer"].includes(value)) throw new Error("--role must be owner, builder, runner, or reviewer.");
  return value as MembershipRole;
}

function requireIssuer(value: string | undefined): string {
  const issuer = value?.trim();
  if (!issuer || issuer.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/.test(issuer)) throw new Error("--issuer must be a stable operator identifier.");
  return issuer;
}

function requireExpiry(value: string): number {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error("--expires-hours must be an integer from 1 to 168.");
  return hours;
}

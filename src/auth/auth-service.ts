import { createHash, randomUUID } from "node:crypto";
import { createSessionToken, readSessionIdentity, type SessionIdentity } from "./session-token.js";
import { hashPassword, verifyPassword } from "./password.js";

export type MembershipRole = "owner" | "builder" | "runner" | "reviewer";

export interface AuthenticatedUser extends SessionIdentity {
  email: string;
  role: MembershipRole;
}

export interface AccountRecord {
  userId: string;
  email: string;
  passwordHash: string;
  defaultTenantId: string | null;
}

export interface AuthStore {
  register(input: {
    tenantId: string;
    tenantName: string;
    userId: string;
    email: string;
    passwordHash: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
  }): Promise<void>;
  findAccountByEmail(email: string): Promise<AccountRecord | undefined>;
  findAccountByIdentity(identity: SessionIdentity): Promise<AccountRecord | undefined>;
  findRole(identity: SessionIdentity): Promise<MembershipRole | undefined>;
  createSession(input: SessionIdentity & { tokenHash: string; expiresAt: Date }): Promise<void>;
  findSession(tokenHash: string, identity: SessionIdentity): Promise<boolean>;
  revokeSession(tokenHash: string, identity: SessionIdentity): Promise<void>;
}

export class AuthInputError extends Error {}
export class EmailAlreadyRegisteredError extends Error {}

// Keep password derivation work consistent when an email has no account.
const timingSafePasswordHash = "scrypt$AAAAAAAAAAAAAAAAAAAAAA$a2FeeCuNRftgLaVKtBhJOzVe8dkMB42q3F3gym78p0Ju8mNMHJlsE6x_1apNcyEl4wQg3kyKlHnmYRpoElQjCw";

export class AuthService {
  public constructor(
    private readonly store: AuthStore,
    private readonly sessionSecret: string,
    private readonly sessionLifetimeMs = 1000 * 60 * 60 * 24 * 14,
  ) {
    if (Buffer.byteLength(sessionSecret) < 32) throw new Error("SESSION_SECRET must be at least 32 bytes.");
  }

  public async signUp(input: { email?: unknown; password?: unknown; tenantName?: unknown }): Promise<{ token: string; user: AuthenticatedUser }> {
    const email = validateEmail(input.email);
    const password = validatePassword(input.password);
    const tenantName = validateTenantName(input.tenantName);
    const identity = { tenantId: randomUUID(), userId: randomUUID() };
    const token = createSessionToken(identity, this.sessionSecret);
    const passwordHash = await hashPassword(password);
    const expiresAt = this.sessionExpiry();

    try {
      await this.store.register({
        ...identity,
        tenantName,
        email,
        passwordHash,
        sessionTokenHash: hashToken(token),
        sessionExpiresAt: expiresAt,
      });
    } catch (error) {
      if (hasDatabaseUniqueViolation(error)) throw new EmailAlreadyRegisteredError("Email is already registered.");
      throw error;
    }

    return { token, user: { ...identity, email, role: "owner" } };
  }

  public async signIn(input: { email?: unknown; password?: unknown }): Promise<{ token: string; user: AuthenticatedUser } | undefined> {
    const email = validateEmail(input.email);
    if (typeof input.password !== "string") throw new AuthInputError("Password is required.");
    const account = await this.store.findAccountByEmail(email);
    const passwordMatches = await verifyPassword(input.password, account?.passwordHash ?? timingSafePasswordHash);
    if (!account || !account.defaultTenantId || !passwordMatches) return undefined;

    const identity = { tenantId: account.defaultTenantId, userId: account.userId };
    const role = await this.store.findRole(identity);
    if (!role) return undefined;
    const token = createSessionToken(identity, this.sessionSecret);
    await this.store.createSession({ ...identity, tokenHash: hashToken(token), expiresAt: this.sessionExpiry() });
    return { token, user: { ...identity, email: account.email, role } };
  }

  public async authenticate(token: string | undefined): Promise<SessionIdentity | undefined> {
    if (!token) return undefined;
    const identity = readSessionIdentity(token, this.sessionSecret);
    if (!identity || !await this.store.findSession(hashToken(token), identity)) return undefined;
    return identity;
  }

  public async signOut(token: string | undefined): Promise<void> {
    if (!token) return;
    const identity = readSessionIdentity(token, this.sessionSecret);
    if (identity) await this.store.revokeSession(hashToken(token), identity);
  }

  public async currentUser(token: string | undefined): Promise<AuthenticatedUser | undefined> {
    const identity = await this.authenticate(token);
    if (!identity) return undefined;
    const role = await this.store.findRole(identity);
    const account = await this.store.findAccountByIdentity(identity);
    if (!role || !account) return undefined;
    return { ...identity, email: account.email, role };
  }

  private sessionExpiry(): Date {
    return new Date(Date.now() + this.sessionLifetimeMs);
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function validateEmail(value: unknown): string {
  if (typeof value !== "string") throw new AuthInputError("Email is required.");
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthInputError("Enter a valid email address.");
  }
  return email;
}

function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) {
    throw new AuthInputError("Password must be between 12 and 128 characters.");
  }
  return value;
}

function validateTenantName(value: unknown): string {
  if (typeof value !== "string") throw new AuthInputError("Workspace name is required.");
  const tenantName = value.trim();
  if (tenantName.length < 1 || tenantName.length > 120) throw new AuthInputError("Workspace name must be 1 to 120 characters.");
  return tenantName;
}

function hasDatabaseUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

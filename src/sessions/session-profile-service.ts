import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "../auth/auth-service.js";

export interface BrowserSessionProfile {
  id: string;
  name: string;
  location: "managed";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserSessionProfileRecord extends BrowserSessionProfile {
  secretReference: string;
}

export interface SessionProfileStore {
  create(user: AuthenticatedUser, profile: BrowserSessionProfileRecord): Promise<BrowserSessionProfile>;
  list(user: AuthenticatedUser): Promise<BrowserSessionProfile[]>;
  findInternal(user: AuthenticatedUser, id: string): Promise<BrowserSessionProfileRecord | undefined>;
  setEnabled(user: AuthenticatedUser, id: string, enabled: boolean): Promise<BrowserSessionProfile | undefined>;
  remove(user: AuthenticatedUser, id: string): Promise<boolean>;
}

export class SessionProfileInputError extends Error {}
export class SessionProfileAccessError extends Error {}

export class SessionProfileService {
  public constructor(private readonly store: SessionProfileStore) {}

  public create(user: AuthenticatedUser, input: unknown): Promise<BrowserSessionProfile> {
    requireOwner(user);
    if (!isRecord(input) || Object.keys(input).some((key) => !["name", "secretReference"].includes(key))) {
      throw new SessionProfileInputError("The browser session request is invalid.");
    }
    const name = text(input.name, "Session name", 120);
    const secretReference = text(input.secretReference, "Secret reference", 500);
    if (!/^(env|vault|aws-sm|gcp-sm):\/\/[a-zA-Z0-9_./:-]+$/.test(secretReference)) {
      throw new SessionProfileInputError("Use an env://, vault://, aws-sm://, or gcp-sm:// secret reference.");
    }
    const timestamp = new Date().toISOString();
    return this.store.create(user, {
      id: randomUUID(),
      name,
      location: "managed",
      secretReference,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  public list(user: AuthenticatedUser): Promise<BrowserSessionProfile[]> {
    return this.store.list(user);
  }

  public async setEnabled(user: AuthenticatedUser, id: string, enabled: boolean): Promise<BrowserSessionProfile> {
    requireOwner(user);
    const profile = await this.store.setEnabled(user, uuid(id), enabled);
    if (!profile) throw new SessionProfileInputError("Browser session not found.");
    return profile;
  }

  public async remove(user: AuthenticatedUser, id: string): Promise<void> {
    requireOwner(user);
    if (!await this.store.remove(user, uuid(id))) throw new SessionProfileInputError("Browser session not found.");
  }
}

function requireOwner(user: AuthenticatedUser): void {
  if (user.role !== "owner") throw new SessionProfileAccessError("Only workspace owners can manage browser sessions.");
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new SessionProfileInputError(`${label} is required and must be ${maxLength} characters or fewer.`);
  }
  return value.trim();
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new SessionProfileInputError("A valid browser session identifier is required.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

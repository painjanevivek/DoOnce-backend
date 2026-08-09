import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { SessionProfileAccessError, SessionProfileInputError, SessionProfileService, type BrowserSessionProfile, type BrowserSessionProfileRecord, type SessionProfileStore } from "../src/sessions/session-profile-service.js";

const owner: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };

class MemoryProfileStore implements SessionProfileStore {
  public internal?: BrowserSessionProfileRecord;
  public create(_user: AuthenticatedUser, profile: BrowserSessionProfileRecord): Promise<BrowserSessionProfile> { this.internal = profile; return Promise.resolve(toPublic(profile)); }
  public list(): Promise<BrowserSessionProfile[]> { return Promise.resolve(this.internal ? [toPublic(this.internal)] : []); }
  public findInternal(): Promise<BrowserSessionProfileRecord | undefined> { return Promise.resolve(this.internal); }
  public setEnabled(_user: AuthenticatedUser, _id: string, enabled: boolean): Promise<BrowserSessionProfile | undefined> { if (!this.internal) return Promise.resolve(undefined); this.internal = { ...this.internal, enabled }; return Promise.resolve(toPublic(this.internal)); }
  public remove(): Promise<boolean> { const found = Boolean(this.internal); this.internal = undefined; return Promise.resolve(found); }
}

function toPublic(profile: BrowserSessionProfileRecord): BrowserSessionProfile {
  return { id: profile.id, name: profile.name, location: profile.location, enabled: profile.enabled, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
}

test("stores a secret reference but never returns it from the public service", async () => {
  const store = new MemoryProfileStore();
  const profile = await new SessionProfileService(store).create(owner, { name: "Finance", secretReference: "env://FINANCE_SESSION" });
  assert.equal("secretReference" in profile, false);
  assert.equal(store.internal?.secretReference, "env://FINANCE_SESSION");
});

test("rejects raw session material and non-owner management", () => {
  const service = new SessionProfileService(new MemoryProfileStore());
  assert.throws(() => service.create(owner, { name: "Bad", secretReference: "{cookies:[]}" }), SessionProfileInputError);
  assert.throws(() => service.create({ ...owner, role: "builder" }, { name: "Finance", secretReference: "env://FINANCE_SESSION" }), SessionProfileAccessError);
});

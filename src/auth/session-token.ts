import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SessionIdentity {
  tenantId: string;
  userId: string;
}

interface SessionPayload extends SessionIdentity {
  version: 1;
  nonce: string;
}

function signatureFor(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createSessionToken(identity: SessionIdentity, secret: string): string {
  const payload: SessionPayload = {
    version: 1,
    tenantId: identity.tenantId,
    userId: identity.userId,
    nonce: randomBytes(24).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signatureFor(encodedPayload, secret).toString("base64url")}`;
}

export function readSessionIdentity(token: string, secret: string): SessionIdentity | undefined {
  const [encodedPayload, encodedSignature, ...extraParts] = token.split(".");
  if (!encodedPayload || !encodedSignature || extraParts.length > 0) return undefined;

  const expectedSignature = signatureFor(encodedPayload, secret);
  const receivedSignature = Buffer.from(encodedSignature, "base64url");
  if (receivedSignature.length !== expectedSignature.length || !timingSafeEqual(receivedSignature, expectedSignature)) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (payload.version !== 1 || typeof payload.tenantId !== "string" || typeof payload.userId !== "string") return undefined;
    if (!uuidPattern.test(payload.tenantId) || !uuidPattern.test(payload.userId)) return undefined;
    return { tenantId: payload.tenantId, userId: payload.userId };
  } catch {
    return undefined;
  }
}

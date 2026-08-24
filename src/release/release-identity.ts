export interface ReleaseIdentity {
  schemaVersion: 1;
  deploymentId: string;
  environment: string;
  backendCommit: string;
  frontendCommit: string;
  backendImageDigest: string;
  frontendImageDigest: string;
  extensionId: string;
  extensionVersion: string;
  extensionPackageSha256: string;
  protocolSchemaSha256: string;
  migrationSetSha256: string;
}

const environmentKeys = {
  deploymentId: "DOONCE_DEPLOYMENT_ID",
  environment: "DOONCE_ENVIRONMENT",
  backendCommit: "DOONCE_BACKEND_COMMIT",
  frontendCommit: "DOONCE_FRONTEND_COMMIT",
  backendImageDigest: "DOONCE_BACKEND_IMAGE_DIGEST",
  frontendImageDigest: "DOONCE_FRONTEND_IMAGE_DIGEST",
  extensionId: "DOONCE_EXTENSION_ID",
  extensionVersion: "DOONCE_EXTENSION_VERSION",
  extensionPackageSha256: "DOONCE_EXTENSION_PACKAGE_SHA256",
  protocolSchemaSha256: "DOONCE_PROTOCOL_SCHEMA_SHA256",
  migrationSetSha256: "DOONCE_MIGRATION_SET_SHA256",
} as const;

export function releaseIdentityFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  required = environment.NODE_ENV === "production" && environment.DOONCE_MVP_MODE === "true",
): ReleaseIdentity | undefined {
  const values = Object.fromEntries(Object.entries(environmentKeys).map(([field, key]) => [field, environment[key]?.trim() ?? ""])) as Record<keyof typeof environmentKeys, string>;
  const configuredCount = Object.values(values).filter(Boolean).length;
  if (configuredCount === 0 && !required) return undefined;
  if (configuredCount !== Object.keys(environmentKeys).length) throw new Error("The deployment release identity is incomplete.");

  assertMatch(values.deploymentId, /^[a-z0-9][a-z0-9._-]{0,79}$/, "DOONCE_DEPLOYMENT_ID");
  assertMatch(values.environment, /^[a-z0-9][a-z0-9._-]{1,39}$/, "DOONCE_ENVIRONMENT");
  assertMatch(values.backendCommit, /^[a-f0-9]{40}$/, "DOONCE_BACKEND_COMMIT");
  assertMatch(values.frontendCommit, /^[a-f0-9]{40}$/, "DOONCE_FRONTEND_COMMIT");
  assertMatch(values.backendImageDigest, /^sha256:[a-f0-9]{64}$/, "DOONCE_BACKEND_IMAGE_DIGEST");
  assertMatch(values.frontendImageDigest, /^sha256:[a-f0-9]{64}$/, "DOONCE_FRONTEND_IMAGE_DIGEST");
  assertMatch(values.extensionId, /^[a-p]{32}$/, "DOONCE_EXTENSION_ID");
  assertMatch(values.extensionVersion, /^\d+\.\d+\.\d+$/, "DOONCE_EXTENSION_VERSION");
  assertMatch(values.extensionPackageSha256, /^[a-f0-9]{64}$/, "DOONCE_EXTENSION_PACKAGE_SHA256");
  assertMatch(values.protocolSchemaSha256, /^[a-f0-9]{64}$/, "DOONCE_PROTOCOL_SCHEMA_SHA256");
  assertMatch(values.migrationSetSha256, /^[a-f0-9]{64}$/, "DOONCE_MIGRATION_SET_SHA256");

  return { schemaVersion: 1, ...values };
}

function assertMatch(value: string, pattern: RegExp, variable: string): void {
  if (!pattern.test(value)) throw new Error(`${variable} is invalid.`);
}

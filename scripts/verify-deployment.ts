import path from "node:path";
import { readFile } from "node:fs/promises";
import { readMigrations, migrationSetSha256 } from "../src/database/migrator.js";
import { releaseIdentityFromEnvironment } from "../src/release/release-identity.js";
import { assertProductionMvpEnvironment } from "../src/system/deployment-policy.js";
import { mvpPolicyFromEnvironment } from "../src/system/mvp-policy.js";
import { allowedOriginsFromEnvironment } from "../src/server.js";

assertProductionMvpEnvironment();
const mvpPolicy = mvpPolicyFromEnvironment();
if (!mvpPolicy.enabled) throw new Error("Deployment verification requires DOONCE_MVP_MODE=true.");
const identity = releaseIdentityFromEnvironment(process.env, true)!;
const protocol = JSON.parse(await readFile(path.join(process.cwd(), "contracts", "manifest.json"), "utf8")) as { schemaSha256: string };
const migrations = await readMigrations(path.join(process.cwd(), "database", "migrations"));
const migrationDigest = migrationSetSha256(migrations);
if (identity.protocolSchemaSha256 !== protocol.schemaSha256) throw new Error("DOONCE_PROTOCOL_SCHEMA_SHA256 does not match the checked-in protocol.");
if (identity.migrationSetSha256 !== migrationDigest) throw new Error("DOONCE_MIGRATION_SET_SHA256 does not match the checked-in migration set.");
const dashboardOrigins = allowedOriginsFromEnvironment(mvpPolicy);
const extensionOrigins = (process.env.DOONCE_EXTENSION_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
if (extensionOrigins.length !== 1 || extensionOrigins[0] !== `chrome-extension://${identity.extensionId}`) throw new Error("DOONCE_EXTENSION_ORIGINS does not match the release extension ID.");

process.stdout.write(`${JSON.stringify({ ready: true, identity, dashboardOrigin: dashboardOrigins[0], pilotOrigin: mvpPolicy.pilotOrigin, migrationCount: migrations.length }, null, 2)}\n`);

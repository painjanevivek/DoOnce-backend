import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { scanTrackedFiles } from "./scan-tracked-secrets.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(repositoryRoot, "security-evidence");
const regressionFiles = [
  "test/action-policy.test.ts",
  "test/artifact-service.test.ts",
  "test/auth-service.test.ts",
  "test/capture-service.test.ts",
  "test/deployment-policy.test.ts",
  "test/mvp-policy.test.ts",
  "test/network-policy.test.ts",
  "test/postgres-artifact-metadata-store.test.ts",
  "test/postgres-capture-store.test.ts",
  "test/postgres-run-receipt-store.test.ts",
  "test/postgres-run-store.test.ts",
  "test/postgres-workflow-store.test.ts",
  "test/run-guardrails.test.ts",
  "test/run-receipt.test.ts",
  "test/run-service.test.ts",
  "test/runtime-role.test.ts",
  "test/server.test.ts",
  "test/tenant-context.test.ts",
];

export async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const secretScan = await scanTrackedFiles();
  await writeFile(path.join(outputDirectory, "backend-tracked-secrets.json"), `${JSON.stringify(secretScan, null, 2)}\n`, "utf8");
  if (secretScan.findings.length > 0) throw new Error(`Tracked secret scan found ${secretScan.findings.length} high-confidence credential candidate(s).`);

  const testRun = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", ...regressionFiles], { cwd: repositoryRoot, encoding: "utf8", env: process.env });
  const rawEvidence = `${testRun.stdout ?? ""}${testRun.stderr ?? ""}`;
  await writeFile(path.join(outputDirectory, "backend-security-regressions.tap"), rawEvidence, "utf8");
  if (testRun.status !== 0) {
    process.stderr.write(rawEvidence);
    throw new Error(`Backend security regressions failed with exit code ${testRun.status ?? "unknown"}.`);
  }

  const sourceCommit = git(["rev-parse", "HEAD"]).trim();
  const sourceTreeDirty = git(["status", "--porcelain", "--untracked-files=all"]).trim().length > 0;
  const releaseMode = process.argv.includes("--release");
  const report = {
    schemaVersion: 1,
    format: "doonce.security-evidence.v1",
    repository: "backend",
    generatedAt: new Date().toISOString(),
    sourceCommit,
    sourceTreeDirty,
    releaseBound: !sourceTreeDirty,
    checks: {
      trackedSecrets: { status: "passed", report: "backend-tracked-secrets.json", scannedFiles: secretScan.scannedFiles },
      focusedRegressions: { status: "passed", report: "backend-security-regressions.tap", files: regressionFiles },
      postgresAuthorization: { status: "ci-companion", command: "npm run test:postgres-security" },
    },
  };
  await writeFile(path.join(outputDirectory, "backend-security-evidence.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (releaseMode && sourceTreeDirty) throw new Error("Release security evidence requires a clean source tree.");
  process.stdout.write(`Backend security evidence passed for ${sourceCommit}${sourceTreeDirty ? " (development tree; CI must produce the release-bound report)" : ""}.\n`);
}

function git(args) {
  const safePath = repositoryRoot.replaceAll("\\", "/");
  const result = spawnSync("git", ["-c", `safe.directory=${safePath}`, ...args], { cwd: repositoryRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Git security-evidence command failed.");
  return result.stdout;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();

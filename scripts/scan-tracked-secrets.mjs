import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const maximumScannedBytes = 5 * 1024 * 1024;
const patterns = [
  { id: "private-key", expression: new RegExp(`-----BEGIN (?:RSA |EC |OPENSSH |DSA )?${"PRIVATE"} KEY-----`, "g") },
  { id: "aws-access-key", expression: new RegExp(`\\b${"AK" + "IA"}[0-9A-Z]{16}\\b`, "g") },
  { id: "github-token", expression: new RegExp(`\\b(?:${["ghp", "gho", "ghu", "ghs", "ghr"].join("|")})_[A-Za-z0-9]{36,255}\\b`, "g") },
  { id: "slack-token", expression: new RegExp(`\\b${"xox"}[baprs]-[A-Za-z0-9-]{20,}\\b`, "g") },
  { id: "stripe-live-secret", expression: new RegExp(`\\b${"sk" + "_live_"}[A-Za-z0-9]{16,}\\b`, "g") },
  { id: "google-api-key", expression: new RegExp(`\\b${"AI" + "za"}[0-9A-Za-z_-]{35}\\b`, "g") },
];

export async function scanTrackedFiles() {
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const findings = [];
  for (const relativePath of files) {
    const contents = await readFile(path.join(repositoryRoot, relativePath));
    if (contents.length > maximumScannedBytes || contents.includes(0)) continue;
    const text = contents.toString("utf8");
    for (const pattern of patterns) {
      pattern.expression.lastIndex = 0;
      for (const match of text.matchAll(pattern.expression)) {
        findings.push({ rule: pattern.id, path: relativePath.replaceAll("\\", "/"), line: text.slice(0, match.index).split("\n").length });
      }
    }
  }
  return { schemaVersion: 1, format: "doonce.tracked-secret-scan.v1", scannedFiles: files.length, findings };
}

function git(args) {
  const safePath = repositoryRoot.replaceAll("\\", "/");
  const result = spawnSync("git", ["-c", `safe.directory=${safePath}`, ...args], { cwd: repositoryRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Git secret-scan discovery failed.");
  return result.stdout;
}

async function main() {
  const report = await scanTrackedFiles();
  const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
  if (outputArgument) await writeFile(path.resolve(repositoryRoot, outputArgument.slice("--output=".length)), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.findings.length > 0) {
    for (const finding of report.findings) process.stderr.write(`${finding.path}:${finding.line} ${finding.rule}\n`);
    throw new Error(`Tracked secret scan found ${report.findings.length} high-confidence credential candidate(s).`);
  }
  process.stdout.write(`Tracked secret scan passed (${report.scannedFiles} files).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();

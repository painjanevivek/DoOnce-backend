import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateMvpProductionDecision } from "../src/release/mvp-production-decision.js";

const filename = process.argv.find((argument) => argument.startsWith("--file="))?.slice("--file=".length);
if (!filename) throw new Error("--file=<production-decision.json> is required.");
const manifest = JSON.parse(await readFile(path.resolve(process.cwd(), filename), "utf8"));
const result = evaluateMvpProductionDecision(manifest);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.pilotReady) process.exitCode = 1;

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateLaunchReadiness } from "../src/release/launch-readiness.js";

const argument = process.argv.find((value) => value.startsWith("--file="));
const path = resolve(argument?.slice("--file=".length) ?? "release/launch-readiness.json");

let input: unknown;
try { input = JSON.parse(await readFile(path, "utf8")); }
catch { console.error(JSON.stringify({ ready: false, blockers: [{ gate: "manifest", reason: `Cannot read a valid launch manifest at ${path}.` }] }, null, 2)); process.exitCode = 1; }

if (input !== undefined) {
  const result = evaluateLaunchReadiness(input);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
}

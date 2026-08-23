import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateExpansionProposal } from "../src/capabilities/expansion-gate.js";

const argument = process.argv.find((value) => value.startsWith("--file="));
const path = resolve(argument?.slice("--file=".length) ?? "governance/expansion-proposal.template.json");
let input: unknown;
try { input = JSON.parse(await readFile(path, "utf8")); }
catch { console.error(JSON.stringify({ approved: false, issues: ["proposal.unreadable"] }, null, 2)); process.exitCode = 1; }
if (input !== undefined) {
  const result = evaluateExpansionProposal(input);
  console.log(JSON.stringify(result, null, 2));
  if (!result.approved) process.exitCode = 1;
}

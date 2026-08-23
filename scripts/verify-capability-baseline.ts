import { readFile } from "node:fs/promises";
import { executableActionKinds, prohibitedActionKinds } from "../src/execution/action-capabilities.js";
import { attendedWedgeCategories } from "../src/beta/beta-types.js";

const baseline = JSON.parse(await readFile(new URL("../governance/capability-baseline.json", import.meta.url), "utf8")) as Record<string, unknown>;
const actual = {
  schemaVersion: 1,
  workflowSpecVersions: [1],
  executableActions: [...executableActionKinds],
  prohibitedActions: [...prohibitedActionKinds],
  executorKinds: ["extension", "hosted-browser"],
  attendedWedgeCategories: [...attendedWedgeCategories],
  authoringProviders: ["template"],
};
if (JSON.stringify(baseline) !== JSON.stringify(actual)) {
  console.error("Capability baseline changed. Add an approved expansion proposal, then update the baseline in the same reviewed change.");
  process.exitCode = 1;
} else {
  console.log("Capability baseline matches the reviewed runtime vocabulary.");
}

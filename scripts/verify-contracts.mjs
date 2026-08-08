import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

const manifest = JSON.parse(await readFile(new URL("../contracts/manifest.json", import.meta.url), "utf8"));
const files = [
  [new URL("../contracts/protocol.v1.schema.json", import.meta.url), manifest.schemaSha256, "schema"],
  [new URL("../src/contracts/protocol.ts", import.meta.url), manifest.typesSha256, "types"],
];
for (const [url, expected, label] of files) {
  const actual = createHash("sha256").update(await readFile(url)).digest("hex");
  if (actual !== expected) throw new Error(`Generated contract ${label} changed without a manifest update.`);
}
process.stdout.write("Contract schema and generated types match manifest v1.\n");

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

const targetArgument = process.argv.find((argument) => argument.startsWith("--target="));
if (!targetArgument) throw new Error("Use --target=<frontend-contracts-directory>.");
const target = path.resolve(targetArgument.slice("--target=".length));
if (path.parse(target).root === target) throw new Error("The contract export target must not be a filesystem root.");
await mkdir(target, { recursive: true });
await cp(new URL("../contracts/protocol.v1.schema.json", import.meta.url), path.join(target, "protocol.v1.schema.json"));
await cp(new URL("../src/contracts/protocol.ts", import.meta.url), path.join(target, "protocol.ts"));
await writeFile(path.join(target, "manifest.json"), await readFile(new URL("../contracts/manifest.json", import.meta.url)));
process.stdout.write(`Exported versioned contracts to ${target}.\n`);

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPendingMvpSmokeManifest } from "../src/release/mvp-smoke-evidence.js";

const contextPath = argument("context");
const outputPath = argument("output");
const context = JSON.parse(await readFile(path.resolve(process.cwd(), contextPath), "utf8"));
const manifest = createPendingMvpSmokeManifest(context);
await writeFile(path.resolve(process.cwd(), outputPath), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`Created pending MVP smoke manifest at ${outputPath}.\n`);

function argument(name: string): string {
  const value = process.argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`--${name}=<path> is required.`);
  return value;
}

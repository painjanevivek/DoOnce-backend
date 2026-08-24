import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPendingMvpPromotionManifest } from "../src/release/mvp-promotion-evidence.js";

const inputPath = argument("input");
const outputPath = argument("output");
const input = JSON.parse(await readFile(path.resolve(process.cwd(), inputPath), "utf8"));
const manifest = createPendingMvpPromotionManifest(input);
await writeFile(path.resolve(process.cwd(), outputPath), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`Created pending MVP promotion manifest at ${outputPath}.\n`);

function argument(name: string): string {
  const value = process.argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`--${name}=<path> is required.`);
  return value;
}

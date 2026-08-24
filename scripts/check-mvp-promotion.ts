import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateMvpPromotionManifest } from "../src/release/mvp-promotion-evidence.js";

const filename = process.argv.find((argument) => argument.startsWith("--file="))?.slice("--file=".length);
if (!filename) throw new Error("--file=<promotion-manifest.json> is required.");
const manifest = JSON.parse(await readFile(path.resolve(process.cwd(), filename), "utf8"));
const result = evaluateMvpPromotionManifest(manifest);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ready) process.exitCode = 1;

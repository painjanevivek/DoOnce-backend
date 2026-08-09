import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

export function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export async function runLoad(config, options) {
  validate(config);
  const deadline = Date.now() + config.durationSeconds * 1000;
  const latencies = [];
  const statuses = new Map();
  let cursor = 0;
  await Promise.all(Array.from({ length: config.concurrency }, async () => {
    while (Date.now() < deadline) {
      const scenario = config.scenarios[cursor++ % config.scenarios.length];
      const started = performance.now();
      let status = 0;
      try {
        const response = await globalThis.fetch(new URL(scenario.path, options.baseUrl), {
          method: scenario.method,
          headers: { Accept: "application/json", Origin: options.origin, ...(options.cookie ? { Cookie: options.cookie } : {}), ...(scenario.body === undefined ? {} : { "Content-Type": "application/json" }) },
          ...(scenario.body === undefined ? {} : { body: JSON.stringify(scenario.body) }),
          signal: globalThis.AbortSignal.timeout(config.requestTimeoutMs),
        });
        status = response.status;
        await response.arrayBuffer();
      } catch { status = 0; }
      latencies.push(performance.now() - started);
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
    }
  }));
  const failures = [...statuses].filter(([status]) => status < 200 || status >= 400).reduce((sum, [, count]) => sum + count, 0);
  return { requests: latencies.length, failures, errorRate: failures / Math.max(latencies.length, 1), p50Ms: percentile(latencies, .5), p95Ms: percentile(latencies, .95), p99Ms: percentile(latencies, .99), statuses: Object.fromEntries([...statuses].sort(([left], [right]) => left - right)) };
}

function validate(config) {
  if (!Number.isInteger(config.durationSeconds) || config.durationSeconds < 1 || config.durationSeconds > 300) throw new Error("durationSeconds must be between 1 and 300.");
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 32) throw new Error("concurrency must be between 1 and 32.");
  if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 100 || config.requestTimeoutMs > 30_000) throw new Error("requestTimeoutMs must be between 100 and 30000.");
  if (!Array.isArray(config.scenarios) || config.scenarios.length < 1 || config.scenarios.length > 20) throw new Error("Provide between 1 and 20 load scenarios.");
  for (const scenario of config.scenarios) {
    if (!scenario || typeof scenario.name !== "string" || !["GET", "POST"].includes(scenario.method) || typeof scenario.path !== "string" || !scenario.path.startsWith("/api/v1/") || scenario.path.includes("..")) throw new Error("Each scenario must be a bounded API GET or POST path.");
  }
}

async function main() {
  const configPath = process.env.LOAD_TEST_SCENARIOS_PATH;
  const baseUrl = process.env.LOAD_TEST_BASE_URL;
  const origin = process.env.LOAD_TEST_ORIGIN;
  if (!configPath || !baseUrl || !origin) throw new Error("LOAD_TEST_SCENARIOS_PATH, LOAD_TEST_BASE_URL, and LOAD_TEST_ORIGIN are required.");
  const parsedBase = new URL(baseUrl);
  if (parsedBase.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsedBase.hostname)) throw new Error("Load tests require HTTPS or an explicit local fixture.");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const result = await runLoad(config, { baseUrl: parsedBase, origin, cookie: process.env.LOAD_TEST_COOKIE });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.errorRate > .01) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();

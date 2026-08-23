import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicWorkflowUrl, compileBoundedPattern, isPublicIpAddress } from "../src/security/network-policy.js";

test("allows an exact HTTPS workflow host that resolves publicly", async () => {
  await assert.doesNotReject(() => assertPublicWorkflowUrl(new URL("https://reports.example.test/export"), ["reports.example.test"], async () => [{ address: "93.184.216.34", family: 4 }]));
});

test("blocks subdomains, redirects, private ranges, and DNS rebinding", async () => {
  await assert.rejects(() => assertPublicWorkflowUrl(new URL("https://cdn.reports.example.test/file"), ["reports.example.test"], async () => [{ address: "93.184.216.34", family: 4 }]));
  await assert.rejects(() => assertPublicWorkflowUrl(new URL("http://reports.example.test/file"), ["reports.example.test"], async () => [{ address: "93.184.216.34", family: 4 }]));
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fd00::1"]) {
    await assert.rejects(() => assertPublicWorkflowUrl(new URL("https://reports.example.test/file"), ["reports.example.test"], async () => [{ address, family: address.includes(":") ? 6 : 4 }]));
  }
  await assert.rejects(() => assertPublicWorkflowUrl(new URL("https://reports.example.test/file"), ["reports.example.test"], async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.8", family: 4 }]));
});

test("classifies reserved networks and rejects unsafe regular expressions", () => {
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("203.0.113.8"), false);
  assert.equal(compileBoundedPattern("^report-[0-9]+$").test("report-42"), true);
  assert.throws(() => compileBoundedPattern("(a+)+$"));
  assert.throws(() => compileBoundedPattern("a".repeat(257)));
});

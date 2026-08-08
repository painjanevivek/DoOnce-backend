import assert from "node:assert/strict";
import test from "node:test";
import { protocolContractNames, validateProtocolContract } from "../src/contracts/validation.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";

test("validates a stored fixture for every protocol contract", () => {
  for (const name of protocolContractNames) {
    assert.deepEqual(validateProtocolContract(name, validProtocolFixtures[name]), { ok: true, value: validProtocolFixtures[name] }, name);
  }
});

test("rejects unknown fields on every protocol object", () => {
  for (const name of protocolContractNames) {
    const fixture = validProtocolFixtures[name];
    assert.equal(typeof fixture, "object");
    const result = validateProtocolContract(name, { ...(fixture as Record<string, unknown>), unknownField: true });
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.errors.some((error) => error.code === "contract.unknown_field" || error.code === "contract.variant"), true, name);
  }
});

test("returns stable paths, codes, and readable messages", () => {
  const result = validateProtocolContract("RunRequest", { schemaVersion: 1, executor: "extension" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors.every((error) => error.code && error.path && !/must have|required property/i.test(error.message)), true);
    assert.match(result.errors.map((error) => error.message).join(" "), /needs run id|needs workflow id/);
  }
});

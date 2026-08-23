import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExpansionProposal, type ExpansionProposal } from "../src/capabilities/expansion-gate.js";

function approvedProposal(kind: ExpansionProposal["capability"]["kind"] = "action"): ExpansionProposal {
  const ref = "governance/evidence/exp-001.json";
  return {
    schemaVersion: 1,
    proposalId: "exp-001",
    capability: { kind, name: kind === "provider" ? "reviewed-provider" : "read-status" },
    demand: { evidenceReference: ref, workflowIds: ["11111111-1111-4111-8111-111111111111"], affectedUsers: 2, repeatedRuns: 8, failureCodes: ["executor.capability-missing"] },
    representation: { workflowSpecReference: ref, compatibilityReference: ref, unsupportedBoundaryReference: ref },
    verification: { successCriteriaReference: ref, failureBehaviorReference: ref, unitTestReference: ref, contractTestReference: ref, integrationTestReference: ref, browserTestReference: ref, endToEndTestReference: ref, ...(kind === "provider" ? { modelEvaluationReference: ref } : {}) },
    authorization: { securityReviewReference: ref, privacyReviewReference: ref, objectPolicyReference: ref },
    operations: { owner: "Runtime Owner", costModelReference: ref, metricsReference: ref, alertReference: ref, incidentRunbookReference: ref },
    migration: { strategy: "additive", migrationReference: ref, rollbackReference: ref, earliestRuntimeVersion: "1.2.0" },
    decision: { outcome: "approved", reviewers: ["Product Reviewer", "Security Reviewer"], decidedAt: "2026-08-24T12:00:00.000Z", decisionReference: ref },
  };
}

test("approves a capability only when every expansion dimension has evidence", () => {
  assert.deepEqual(evaluateExpansionProposal(approvedProposal()), { approved: true, issues: [] });
});

test("requires a model evaluation for an authoring provider", () => {
  const proposal = approvedProposal("provider");
  delete proposal.verification.modelEvaluationReference;
  assert.deepEqual(evaluateExpansionProposal(proposal).issues, ["proposal.model-evaluation-required"]);
});

test("keeps rejected and incomplete proposals out of development", () => {
  const proposal = approvedProposal();
  proposal.demand.workflowIds = [];
  proposal.operations.metricsReference = "TBD";
  proposal.decision = { outcome: "needs-evidence", reviewers: [] };
  const result = evaluateExpansionProposal(proposal);
  assert.equal(result.approved, false);
  assert.deepEqual(result.issues, ["proposal.demand-evidence-required", "proposal.operations-ownership-required", "proposal.decision-needs-evidence"]);
});

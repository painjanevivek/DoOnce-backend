export const safeReportWorkflowFixture = {
  id: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  version: 1,
  tenantId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  ownerId: "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  title: "Download weekly sales report",
  allowedDomains: ["reports.example.test"],
  steps: [{
    id: "d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
    kind: "download",
    name: "Download this week's report",
    expectedOutcome: "A CSV report is downloaded.",
    domain: "reports.example.test",
    path: "/weekly-report",
  }],
} as const;

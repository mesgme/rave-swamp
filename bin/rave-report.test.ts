import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { renderHealthReport } from "./rave-report.ts";

const CLAIM_ROWS = [
  {
    claimId: "claim-ci-green-on-main-001",
    status: "active",
    category: "reliability",
    scope: "pipeline:mesgme/rave-swamp/main",
    confidenceScore: 0.62,
    previousScore: null,
    computedAt: "2026-04-30T10:00:00Z",
    level: "medium",
    guidance: ["CI run #12345 failed", "Check the Actions log"],
  },
  {
    claimId: "claim-branch-protection-001",
    status: "active",
    category: "change_risk",
    scope: "pipeline:mesgme/rave-swamp/main",
    confidenceScore: 1.0,
    previousScore: null,
    computedAt: "2026-04-30T10:00:00Z",
    level: "high",
    guidance: [],
  },
];

Deno.test("renderHealthReport contains the sentinel comment", () => {
  const report = renderHealthReport(CLAIM_ROWS, 0.7);
  assertStringIncludes(report, "<!-- rave-health -->");
});

Deno.test("renderHealthReport contains the heading", () => {
  const report = renderHealthReport(CLAIM_ROWS, 0.7);
  assertStringIncludes(report, "## rave health");
});

Deno.test("renderHealthReport includes each claim ID", () => {
  const report = renderHealthReport(CLAIM_ROWS, 0.7);
  assertStringIncludes(report, "claim-ci-green-on-main-001");
  assertStringIncludes(report, "claim-branch-protection-001");
});

Deno.test("renderHealthReport marks below-threshold score with ⚠️", () => {
  const report = renderHealthReport(CLAIM_ROWS, 0.7);
  assertStringIncludes(report, "⚠️");
});

Deno.test("renderHealthReport marks healthy score with ✓", () => {
  const report = renderHealthReport(CLAIM_ROWS, 0.7);
  assertStringIncludes(report, "✓");
});

Deno.test("renderHealthReport shows below-threshold count", () => {
  const report = renderHealthReport(CLAIM_ROWS, 0.7);
  assertStringIncludes(report, "1 claim below threshold");
});

Deno.test("renderHealthReport shows guidance in details block", () => {
  const report = renderHealthReport(CLAIM_ROWS, 0.7);
  assertStringIncludes(report, "<details>");
  assertStringIncludes(report, "CI run #12345 failed");
  assertStringIncludes(report, "Check the Actions log");
});

Deno.test("renderHealthReport omits details block when no guidance", () => {
  const noGuidanceRows = [{ ...CLAIM_ROWS[1] }];
  const report = renderHealthReport(noGuidanceRows, 0.7);
  assertEquals(report.includes("<details>"), false);
});

Deno.test("renderHealthReport shows all green message when healthy", () => {
  const healthyRows = [{ ...CLAIM_ROWS[1] }];
  const report = renderHealthReport(healthyRows, 0.7);
  assertStringIncludes(report, "all claims");
});

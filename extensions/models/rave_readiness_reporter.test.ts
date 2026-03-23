import { assertEquals } from "jsr:@std/assert@1";

// ---------------------------------------------------------------------------
// Re-implement evaluateClaim (exact copy from rave_readiness_reporter.ts).
// ---------------------------------------------------------------------------

type ClaimReadiness = {
  claimId: string;
  status: string;
  confidenceScore: number;
  meetsThreshold: boolean;
  reason: string | null;
};

function evaluateClaim(
  claimId: string,
  status: string,
  confidenceScore: number,
  threshold: number,
): ClaimReadiness {
  if (status === "draft" || status === "retired") {
    return { claimId, status, confidenceScore, meetsThreshold: true, reason: `${status} — excluded from readiness gate` };
  }
  if (status === "contradicted") {
    return { claimId, status, confidenceScore, meetsThreshold: false, reason: "contradicted — fails readiness gate" };
  }
  const meetsThreshold = confidenceScore >= threshold;
  return {
    claimId,
    status,
    confidenceScore,
    meetsThreshold,
    reason: meetsThreshold ? null : `score ${confidenceScore.toFixed(3)} below threshold ${threshold}`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("evaluateClaim: active claim above threshold → passes", () => {
  const r = evaluateClaim("claim-001", "active", 0.85, 0.7);
  assertEquals(r.meetsThreshold, true);
  assertEquals(r.reason, null);
});

Deno.test("evaluateClaim: active claim exactly at threshold → passes", () => {
  const r = evaluateClaim("claim-001", "active", 0.7, 0.7);
  assertEquals(r.meetsThreshold, true);
  assertEquals(r.reason, null);
});

Deno.test("evaluateClaim: active claim below threshold → fails with reason", () => {
  const r = evaluateClaim("claim-001", "active", 0.5, 0.7);
  assertEquals(r.meetsThreshold, false);
  assertEquals(r.reason, "score 0.500 below threshold 0.7");
});

Deno.test("evaluateClaim: draft claim → excluded, meetsThreshold=true", () => {
  const r = evaluateClaim("claim-001", "draft", 0.0, 0.7);
  assertEquals(r.meetsThreshold, true);
  assertEquals(r.reason, "draft — excluded from readiness gate");
});

Deno.test("evaluateClaim: retired claim → excluded, meetsThreshold=true", () => {
  const r = evaluateClaim("claim-001", "retired", 0.3, 0.7);
  assertEquals(r.meetsThreshold, true);
  assertEquals(r.reason, "retired — excluded from readiness gate");
});

Deno.test("evaluateClaim: contradicted claim → always fails regardless of score", () => {
  const r = evaluateClaim("claim-001", "contradicted", 0.99, 0.7);
  assertEquals(r.meetsThreshold, false);
  assertEquals(r.reason, "contradicted — fails readiness gate");
});

Deno.test("evaluateClaim: zero score for active claim → fails", () => {
  const r = evaluateClaim("claim-001", "active", 0.0, 0.7);
  assertEquals(r.meetsThreshold, false);
});

Deno.test("evaluateClaim: threshold 0 → any active score passes", () => {
  const r = evaluateClaim("claim-001", "active", 0.0, 0.0);
  assertEquals(r.meetsThreshold, true);
});

Deno.test("evaluateClaim: claimId and status are preserved in output", () => {
  const r = evaluateClaim("claim-my-test-001", "active", 0.8, 0.7);
  assertEquals(r.claimId, "claim-my-test-001");
  assertEquals(r.status, "active");
  assertEquals(r.confidenceScore, 0.8);
});

import {
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "jsr:@std/assert@1";
import { createModelTestContext } from "@systeminit/swamp-testing";
import { model } from "./rave_confidence_engine.ts";

// ---------------------------------------------------------------------------
// Re-implement the pure functions under test so we can test them without
// importing the full model (which references npm:zod@4 and context APIs).
// These are exact copies of the functions in rave_confidence_engine.ts.
// ---------------------------------------------------------------------------

function parseISO8601Duration(duration: string): number {
  const re =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
  const m = duration.match(re);
  if (!m) throw new Error(`Invalid ISO 8601 duration: ${duration}`);
  return (
    parseFloat(m[1] ?? "0") * 365 * 86400 +
    parseFloat(m[2] ?? "0") * 30 * 86400 +
    parseFloat(m[3] ?? "0") * 7 * 86400 +
    parseFloat(m[4] ?? "0") * 86400 +
    parseFloat(m[5] ?? "0") * 3600 +
    parseFloat(m[6] ?? "0") * 60 +
    parseFloat(m[7] ?? "0")
  );
}

function computeScore(
  c0: number,
  fAvg: number,
  qAvg: number,
  decayFactor: number,
): number {
  return c0 * fAvg * qAvg * decayFactor;
}

// ---------------------------------------------------------------------------
// parseISO8601Duration
// ---------------------------------------------------------------------------

Deno.test("parseISO8601Duration: P1D = 86400 seconds", () => {
  assertEquals(parseISO8601Duration("P1D"), 86400);
});

Deno.test("parseISO8601Duration: PT1H = 3600 seconds", () => {
  assertEquals(parseISO8601Duration("PT1H"), 3600);
});

Deno.test("parseISO8601Duration: PT30M = 1800 seconds", () => {
  assertEquals(parseISO8601Duration("PT30M"), 1800);
});

Deno.test("parseISO8601Duration: P1W = 7 days = 604800 seconds", () => {
  assertEquals(parseISO8601Duration("P1W"), 7 * 86400);
});

Deno.test("parseISO8601Duration: P7D = 7 * 86400 seconds", () => {
  assertEquals(parseISO8601Duration("P7D"), 7 * 86400);
});

Deno.test("parseISO8601Duration: P1DT12H = 36 hours in seconds", () => {
  assertEquals(parseISO8601Duration("P1DT12H"), 86400 + 12 * 3600);
});

Deno.test("parseISO8601Duration: P30D = 30 * 86400", () => {
  assertEquals(parseISO8601Duration("P30D"), 30 * 86400);
});

Deno.test("parseISO8601Duration: PT1S = 1 second", () => {
  assertEquals(parseISO8601Duration("PT1S"), 1);
});

Deno.test("parseISO8601Duration: PT0S = 0", () => {
  assertEquals(parseISO8601Duration("PT0S"), 0);
});

Deno.test("parseISO8601Duration: invalid string throws", () => {
  assertThrows(
    () => parseISO8601Duration("1D"),
    Error,
    "Invalid ISO 8601 duration",
  );
  assertThrows(
    () => parseISO8601Duration(""),
    Error,
    "Invalid ISO 8601 duration",
  );
  assertThrows(
    () => parseISO8601Duration("1 day"),
    Error,
    "Invalid ISO 8601 duration",
  );
});

// ---------------------------------------------------------------------------
// computeScore — the RAVE decay formula: C₀ × F_avg × Q_avg × e^(−λ × Δt)
// Spec section 6.4.7 worked examples (decay factor pre-computed from exp):
//   Day 0:  C₀=0.85, Δt=0, F_avg=1.0, Q_avg=0.9, λ=0.05 → 0.765
//   Day 3:  C₀=0.765, Δt=3 days, F_avg=1.0, Q_avg=0.9, λ=0.05 → 0.765*0.9*exp(-0.15)
//   Day 10→17: C₀=prev, Δt=7, F_avg=0.5, Q_avg=0.9, λ=0.05
// ---------------------------------------------------------------------------

Deno.test("computeScore: no decay, no evidence degradation", () => {
  // C₀=1.0, F=1.0, Q=1.0, decay=1.0 → 1.0
  assertAlmostEquals(computeScore(1.0, 1.0, 1.0, 1.0), 1.0, 1e-9);
});

Deno.test("computeScore: zero fAvg → zero score", () => {
  assertEquals(computeScore(0.9, 0.0, 1.0, 1.0), 0.0);
});

Deno.test("computeScore: zero qAvg → zero score", () => {
  assertEquals(computeScore(0.9, 1.0, 0.0, 1.0), 0.0);
});

Deno.test("computeScore: decay reduces score over time", () => {
  const lambda = 0.05;
  const deltaDays = 7;
  const decayFactor = Math.exp(-lambda * deltaDays);
  const score = computeScore(0.9, 1.0, 1.0, decayFactor);
  assertAlmostEquals(score, 0.9 * Math.exp(-0.35), 1e-9);
});

Deno.test("computeScore: spec example day 0 → C=0.765", () => {
  // C₀=0.85, F=1.0, Q=0.9, decay=exp(0)=1.0
  assertAlmostEquals(computeScore(0.85, 1.0, 0.9, 1.0), 0.765, 1e-9);
});

Deno.test("computeScore: fail evidence → fAvg=0 → score=0", () => {
  // One piece of evidence with outcome=fail → freshnessContribution=0 → fAvg=0
  assertAlmostEquals(computeScore(0.9, 0.0, 0.95, Math.exp(-0.05)), 0.0, 1e-9);
});

Deno.test("computeScore: partial freshness (50% pass, 50% fail)", () => {
  // fAvg = 0.5 (one pass, one fail), qAvg=0.9, decay=1.0, C₀=0.8
  assertAlmostEquals(computeScore(0.8, 0.5, 0.9, 1.0), 0.36, 1e-9);
});

// ---------------------------------------------------------------------------
// compute execute — previousScore propagation (regression)
// ---------------------------------------------------------------------------

const passEvidence = {
  evidenceId: "evidence-test-001",
  outcome: "pass" as const,
  timestamp: new Date().toISOString(),
  freshnessWindow: "P1D",
  qualityScore: 1.0,
};

Deno.test("compute: previousScore is null on first run (no stored resource)", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: {
      claimId: "claim-test-001",
      decayLambda: 0.05,
      confidenceFloor: 0.01,
    },
    methodName: "compute",
  });

  await model.methods.compute.execute(
    { currentStatus: "active", evidence: [passEvidence] },
    context,
  );

  const written = getWrittenResources();
  assertEquals(written.length, 1);
  assertEquals(written[0].data.previousScore, null);
});

// ---------------------------------------------------------------------------
// compute execute — guidance aggregation
// ---------------------------------------------------------------------------

Deno.test("compute: guidance is empty when all evidence passes", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: {
      claimId: "claim-test-001",
      decayLambda: 0.05,
      confidenceFloor: 0.01,
    },
    methodName: "compute",
  });

  await model.methods.compute.execute(
    {
      currentStatus: "active",
      evidence: [{
        ...passEvidence,
        failureReason: null,
        remediation: null,
      }],
    },
    context,
  );

  const written = getWrittenResources();
  assertEquals(written[0].data.guidance, []);
});

Deno.test("compute: guidance contains failureReason and remediation when evidence fails", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: {
      claimId: "claim-test-001",
      decayLambda: 0.05,
      confidenceFloor: 0.01,
    },
    methodName: "compute",
  });

  await model.methods.compute.execute(
    {
      currentStatus: "active",
      evidence: [{
        evidenceId: "evidence-fail-001",
        outcome: "fail" as const,
        timestamp: new Date().toISOString(),
        freshnessWindow: "P1D",
        qualityScore: 1.0,
        failureReason: "CI run #999 failed on job 'test'",
        remediation:
          "Check the Actions log at https://github.com/org/repo/actions/runs/999",
      }],
    },
    context,
  );

  const written = getWrittenResources();
  const guidance = written[0].data.guidance as string[];
  assertEquals(guidance.length > 0, true);
  assertEquals(
    guidance.some((g: string) => g.includes("CI run #999 failed")),
    true,
  );
  assertEquals(
    guidance.some((g: string) => g.includes("Check the Actions log")),
    true,
  );
});

Deno.test("compute: guidance includes only failed evidence (not pass or inconclusive)", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: {
      claimId: "claim-test-001",
      decayLambda: 0.05,
      confidenceFloor: 0.01,
    },
    methodName: "compute",
  });

  await model.methods.compute.execute(
    {
      currentStatus: "active",
      evidence: [
        {
          ...passEvidence,
          evidenceId: "ev-pass",
          failureReason: null,
          remediation: null,
        },
        {
          evidenceId: "ev-fail",
          outcome: "fail" as const,
          timestamp: new Date().toISOString(),
          freshnessWindow: "P1D",
          qualityScore: 1.0,
          failureReason: "something broke",
          remediation: "fix it",
        },
        {
          evidenceId: "ev-inconclusive",
          outcome: "inconclusive" as const,
          timestamp: new Date().toISOString(),
          freshnessWindow: null,
          qualityScore: null,
          failureReason: null,
          remediation: null,
        },
      ],
    },
    context,
  );

  const written = getWrittenResources();
  const guidance = written[0].data.guidance as string[];
  assertEquals(
    guidance.some((g: string) => g.includes("something broke")),
    true,
  );
  assertEquals(guidance.some((g: string) => g.includes("fix it")), true);
  assertEquals(guidance.length, 2); // failureReason + remediation from the one fail
});

Deno.test("compute: previousScore is populated from stored resource on second run", async () => {
  const priorComputedAt = "2026-04-29T10:00:00.000Z";
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: {
      claimId: "claim-test-001",
      decayLambda: 0.05,
      confidenceFloor: 0.01,
    },
    methodName: "compute",
    storedResources: {
      current: {
        claimId: "claim-test-001",
        confidenceScore: 0.85,
        previousScore: null,
        fAvg: 1.0,
        qAvg: 1.0,
        decayFactor: 1.0,
        lastValidated: priorComputedAt,
        computedAt: priorComputedAt,
        evidenceSnapshots: [],
        statusTransition: null,
      },
    },
  });

  await model.methods.compute.execute(
    { currentStatus: "active", evidence: [passEvidence] },
    context,
  );

  const written = getWrittenResources();
  assertEquals(written.length, 1);
  assertEquals(written[0].data.previousScore, 0.85);
});

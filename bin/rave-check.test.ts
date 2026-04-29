import { assertEquals } from "jsr:@std/assert@1";
import { checkClaims, type CheckResult } from "./rave-check.ts";
import type { Claim, ConfidenceData } from "./lib/types.ts";

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    claim_id: "claim-test-001",
    statement: "test claim",
    status: "active",
    category: "reliability",
    scope: { type: "repository", target: "org/repo" },
    scopeKey: "repository:org/repo",
    decay_lambda: 0.05,
    ...overrides,
  };
}

function makeConfidence(overrides: Partial<ConfidenceData> = {}): ConfidenceData {
  return {
    claimId: "claim-test-001",
    confidenceScore: 0.85,
    previousScore: null,
    computedAt: "2026-04-29T10:00:00Z",
    lastValidated: "2026-04-29T10:00:00Z",
    fAvg: 1.0,
    qAvg: 1.0,
    decayFactor: 1.0,
    statusTransition: null,
    guidance: [],
    ...overrides,
  };
}

Deno.test("checkClaims: ok=true when all active claims are above threshold with no guidance", () => {
  const claims = [makeClaim({ claim_id: "c1" }), makeClaim({ claim_id: "c2" })];
  const confidence = new Map([
    ["c1", makeConfidence({ claimId: "c1", confidenceScore: 0.85 })],
    ["c2", makeConfidence({ claimId: "c2", confidenceScore: 0.90 })],
  ]);
  const result = checkClaims(claims, confidence, 0.7);
  assertEquals(result.ok, true);
  assertEquals(result.claims.length, 0);
});

Deno.test("checkClaims: ok=false when a claim is below threshold", () => {
  const claims = [makeClaim({ claim_id: "c1" }), makeClaim({ claim_id: "c2" })];
  const confidence = new Map([
    ["c1", makeConfidence({ claimId: "c1", confidenceScore: 0.85 })],
    ["c2", makeConfidence({ claimId: "c2", confidenceScore: 0.50 })],
  ]);
  const result = checkClaims(claims, confidence, 0.7);
  assertEquals(result.ok, false);
  assertEquals(result.claims.length, 1);
  assertEquals(result.claims[0].claimId, "c2");
  assertEquals(result.claims[0].score, 0.50);
});

Deno.test("checkClaims: ok=false when a claim has non-empty guidance", () => {
  const claims = [makeClaim({ claim_id: "c1" })];
  const confidence = new Map([
    ["c1", makeConfidence({
      claimId: "c1",
      confidenceScore: 0.85,
      guidance: ["CI run failed on job test", "Check the Actions log"],
    })],
  ]);
  const result = checkClaims(claims, confidence, 0.7);
  assertEquals(result.ok, false);
  assertEquals(result.claims.length, 1);
  assertEquals(result.claims[0].guidance.length, 2);
});

Deno.test("checkClaims: non-active claims are excluded", () => {
  const claims = [
    makeClaim({ claim_id: "c1", status: "draft" }),
    makeClaim({ claim_id: "c2", status: "retired" }),
    makeClaim({ claim_id: "c3", status: "contradicted" }),
  ];
  const confidence = new Map([
    ["c1", makeConfidence({ claimId: "c1", confidenceScore: 0.0 })],
    ["c2", makeConfidence({ claimId: "c2", confidenceScore: 0.0 })],
    ["c3", makeConfidence({ claimId: "c3", confidenceScore: 0.0 })],
  ]);
  const result = checkClaims(claims, confidence, 0.7);
  assertEquals(result.ok, true);
  assertEquals(result.claims.length, 0);
});

Deno.test("checkClaims: claim row includes level", () => {
  const claims = [makeClaim({ claim_id: "c1" })];
  const confidence = new Map([
    ["c1", makeConfidence({ claimId: "c1", confidenceScore: 0.30 })],
  ]);
  const result = checkClaims(claims, confidence, 0.7);
  assertEquals(result.claims[0].level, "low");
});

Deno.test("checkClaims: result type is CheckResult", () => {
  const result: CheckResult = checkClaims([], new Map(), 0.7);
  assertEquals(result.ok, true);
  assertEquals(result.claims.length, 0);
});

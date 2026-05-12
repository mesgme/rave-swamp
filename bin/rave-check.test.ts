import { assertEquals } from "jsr:@std/assert@1";
import {
  checkClaims,
  type CheckResult,
  injectCveFindings,
} from "./rave-check.ts";
import type { Claim, ConfidenceData } from "./lib/types.ts";
import type { CveFinding } from "./rave-cve-scan.ts";

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

function makeConfidence(
  overrides: Partial<ConfidenceData> = {},
): ConfidenceData {
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
    [
      "c1",
      makeConfidence({
        claimId: "c1",
        confidenceScore: 0.85,
        guidance: ["CI run failed on job test", "Check the Actions log"],
      }),
    ],
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

// ---------------------------------------------------------------------------
// injectCveFindings
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<CveFinding> = {}): CveFinding {
  return {
    pkg: "yaml",
    version: "2.7.0",
    osvId: "GHSA-48c2-rrv3-qjmp",
    severity: "CVSS_V3",
    fixedVersion: "2.8.3",
    ...overrides,
  };
}

Deno.test("injectCveFindings: no-op when findings is empty", () => {
  const confidence = new Map<string, ConfidenceData>();
  injectCveFindings(confidence, []);
  assertEquals(confidence.size, 0);
});

Deno.test("injectCveFindings: adds guidance to claim-no-known-cves-001", () => {
  const confidence = new Map<string, ConfidenceData>();
  injectCveFindings(confidence, [makeFinding()]);
  const entry = confidence.get("claim-no-known-cves-001");
  assertEquals(entry?.guidance.length, 1);
  assertEquals(
    entry?.guidance[0],
    "GHSA-48c2-rrv3-qjmp [CVSS_V3] yaml@2.7.0 (fixed in 2.8.3)",
  );
});

Deno.test("injectCveFindings: omits fix text when fixedVersion is null", () => {
  const confidence = new Map<string, ConfidenceData>();
  injectCveFindings(confidence, [makeFinding({ fixedVersion: null })]);
  const entry = confidence.get("claim-no-known-cves-001");
  assertEquals(entry?.guidance[0], "GHSA-48c2-rrv3-qjmp [CVSS_V3] yaml@2.7.0");
});

Deno.test("injectCveFindings: appends to existing guidance", () => {
  const existing = makeConfidence({
    claimId: "claim-no-known-cves-001",
    guidance: ["prior guidance"],
  });
  const confidence = new Map([["claim-no-known-cves-001", existing]]);
  injectCveFindings(confidence, [makeFinding()]);
  assertEquals(confidence.get("claim-no-known-cves-001")?.guidance.length, 2);
});

Deno.test("injectCveFindings: preserves existing confidence score", () => {
  const existing = makeConfidence({
    claimId: "claim-no-known-cves-001",
    confidenceScore: 0.75,
  });
  const confidence = new Map([["claim-no-known-cves-001", existing]]);
  injectCveFindings(confidence, [makeFinding()]);
  assertEquals(
    confidence.get("claim-no-known-cves-001")?.confidenceScore,
    0.75,
  );
});

Deno.test("injectCveFindings: triggers checkClaims failure for CVE claim", () => {
  const claim = makeClaim(
    { claim_id: "claim-no-known-cves-001", confidenceScore: 0.85 } as never,
  );
  const claims = [{ ...claim, claim_id: "claim-no-known-cves-001" }];
  const confidence = new Map<string, ConfidenceData>();
  injectCveFindings(confidence, [makeFinding()]);
  const result = checkClaims(claims, confidence, 0.7);
  assertEquals(result.ok, false);
  assertEquals(result.claims[0].claimId, "claim-no-known-cves-001");
  assertEquals(result.claims[0].guidance.length, 1);
});

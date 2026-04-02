import { assertEquals } from "jsr:@std/assert@1";
import { confidenceLevel, renderScopeTree, renderClaimsTable } from "./render.ts";
import type { Claim, ConfidenceData, ScopeNode } from "./types.ts";

// --- confidenceLevel ---

Deno.test("confidenceLevel: >= 0.8 is high", () => {
  assertEquals(confidenceLevel(0.8), "high");
  assertEquals(confidenceLevel(0.95), "high");
  assertEquals(confidenceLevel(1.0), "high");
});

Deno.test("confidenceLevel: >= 0.5 and < 0.8 is medium", () => {
  assertEquals(confidenceLevel(0.5), "medium");
  assertEquals(confidenceLevel(0.79), "medium");
});

Deno.test("confidenceLevel: >= 0.2 and < 0.5 is low", () => {
  assertEquals(confidenceLevel(0.2), "low");
  assertEquals(confidenceLevel(0.49), "low");
});

Deno.test("confidenceLevel: < 0.2 is critical", () => {
  assertEquals(confidenceLevel(0.19), "critical");
  assertEquals(confidenceLevel(0.0), "critical");
});

// --- renderScopeTree ---

Deno.test("renderScopeTree highlights selected scope", () => {
  const root: ScopeNode = {
    type: "repository",
    target: "org/repo",
    description: "",
    children: [],
    key: "repository:org/repo",
  };
  const output = renderScopeTree(root, [root], 0);
  // Selected item should contain inverse video escape
  assertEquals(output.includes("\x1b[7m"), true);
});

Deno.test("renderScopeTree renders children with connectors", () => {
  const child: ScopeNode = {
    type: "pipeline",
    target: "org/repo/main",
    description: "",
    children: [],
    key: "pipeline:org/repo/main",
  };
  const root: ScopeNode = {
    type: "repository",
    target: "org/repo",
    description: "",
    children: [child],
    key: "repository:org/repo",
  };
  const flat = [root, child];
  const output = renderScopeTree(root, flat, 0);
  assertEquals(output.includes("└─"), true);
});

// --- renderClaimsTable ---

Deno.test("renderClaimsTable shows N/A for missing confidence", () => {
  const claims: Claim[] = [{
    claim_id: "claim-test-001",
    statement: "test",
    status: "active",
    category: "reliability",
    scope: { type: "repository", target: "org/repo" },
    scopeKey: "repository:org/repo",
    decay_lambda: 0.05,
  }];
  const confidence = new Map<string, ConfidenceData>();
  const output = renderClaimsTable(claims, confidence);
  assertEquals(output.includes("N/A"), true);
});

Deno.test("renderClaimsTable shows score for known confidence", () => {
  const claims: Claim[] = [{
    claim_id: "claim-test-001",
    statement: "test",
    status: "active",
    category: "reliability",
    scope: { type: "repository", target: "org/repo" },
    scopeKey: "repository:org/repo",
    decay_lambda: 0.05,
  }];
  const confidence = new Map<string, ConfidenceData>([
    ["claim-test-001", {
      claimId: "claim-test-001",
      confidenceScore: 0.85,
      previousScore: null,
      computedAt: "2026-03-30T10:00:00Z",
      lastValidated: "2026-03-28T10:00:00Z",
      fAvg: 1.0,
      qAvg: 1.0,
      decayFactor: 1.0,
      statusTransition: null,
    }],
  ]);
  const output = renderClaimsTable(claims, confidence);
  assertEquals(output.includes("0.850"), true);
});

Deno.test("renderClaimsTable shows trend arrow for score change", () => {
  const claims: Claim[] = [{
    claim_id: "claim-test-001",
    statement: "test",
    status: "active",
    category: "reliability",
    scope: { type: "repository", target: "org/repo" },
    scopeKey: "repository:org/repo",
    decay_lambda: 0.05,
  }];
  const confidence = new Map<string, ConfidenceData>([
    ["claim-test-001", {
      claimId: "claim-test-001",
      confidenceScore: 0.72,
      previousScore: 0.85,
      computedAt: "2026-03-30T10:00:00Z",
      lastValidated: "2026-03-28T10:00:00Z",
      fAvg: 1.0,
      qAvg: 0.95,
      decayFactor: 0.9,
      statusTransition: "0.850→0.720",
    }],
  ]);
  const output = renderClaimsTable(claims, confidence);
  assertEquals(output.includes("↓"), true);
});

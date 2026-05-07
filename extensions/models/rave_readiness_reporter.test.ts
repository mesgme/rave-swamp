import { assertEquals } from "jsr:@std/assert@1";

// ---------------------------------------------------------------------------
// Re-implement evaluateNode (exact copy from rave_readiness_reporter.ts).
// ---------------------------------------------------------------------------

type EvaluatedNode = {
  nodeId: string;
  nodeType: string;
  confidence: number;
  aboveThreshold: boolean;
  reason?: string;
};

type FailingNode = {
  nodeId: string;
  nodeType: string;
  confidence: number;
  threshold: number;
  reason: string;
  suggestedRemediation?: string;
};

function evaluateNode(
  nodeId: string,
  nodeType: string,
  status: string,
  confidenceScore: number,
  threshold: number,
): { evaluated: EvaluatedNode; failing: FailingNode | null } {
  if (status === "draft" || status === "retired") {
    return {
      evaluated: {
        nodeId,
        nodeType,
        confidence: confidenceScore,
        aboveThreshold: true,
        reason: `${status} — excluded from readiness gate`,
      },
      failing: null,
    };
  }
  if (status === "contradicted") {
    const reason = "Contradicted — requires revision";
    return {
      evaluated: {
        nodeId,
        nodeType,
        confidence: confidenceScore,
        aboveThreshold: false,
        reason,
      },
      failing: {
        nodeId,
        nodeType,
        confidence: confidenceScore,
        threshold,
        reason,
      },
    };
  }
  if (status === "unknown") {
    const reason = "Status unknown — no runtime data available";
    return {
      evaluated: {
        nodeId,
        nodeType,
        confidence: 0,
        aboveThreshold: false,
        reason,
      },
      failing: { nodeId, nodeType, confidence: 0, threshold, reason },
    };
  }
  const aboveThreshold = confidenceScore >= threshold;
  if (aboveThreshold) {
    return {
      evaluated: {
        nodeId,
        nodeType,
        confidence: confidenceScore,
        aboveThreshold: true,
      },
      failing: null,
    };
  }
  const reason = `Confidence ${
    confidenceScore.toFixed(3)
  } below threshold ${threshold}`;
  return {
    evaluated: {
      nodeId,
      nodeType,
      confidence: confidenceScore,
      aboveThreshold: false,
      reason,
    },
    failing: {
      nodeId,
      nodeType,
      confidence: confidenceScore,
      threshold,
      reason,
    },
  };
}

function inScope(
  nodeScopeType: string,
  nodeScopeTarget: string,
  filterType: string,
  filterTarget: string,
  includeDescendants: boolean,
): boolean {
  if (nodeScopeType === filterType && nodeScopeTarget === filterTarget) {
    return true;
  }
  if (includeDescendants && nodeScopeTarget.startsWith(filterTarget + "/")) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// evaluateNode tests
// ---------------------------------------------------------------------------

Deno.test("evaluateNode: active above threshold → passes, no reason", () => {
  const { evaluated, failing } = evaluateNode(
    "claim-001",
    "claim",
    "active",
    0.85,
    0.7,
  );
  assertEquals(evaluated.aboveThreshold, true);
  assertEquals(evaluated.reason, undefined);
  assertEquals(failing, null);
});

Deno.test("evaluateNode: active exactly at threshold → passes", () => {
  const { evaluated, failing } = evaluateNode(
    "claim-001",
    "claim",
    "active",
    0.7,
    0.7,
  );
  assertEquals(evaluated.aboveThreshold, true);
  assertEquals(failing, null);
});

Deno.test("evaluateNode: active below threshold → fails with reason including score and threshold", () => {
  const { evaluated, failing } = evaluateNode(
    "claim-001",
    "claim",
    "active",
    0.5,
    0.7,
  );
  assertEquals(evaluated.aboveThreshold, false);
  assertEquals(evaluated.reason, "Confidence 0.500 below threshold 0.7");
  assertEquals(failing?.reason, "Confidence 0.500 below threshold 0.7");
  assertEquals(failing?.threshold, 0.7);
});

Deno.test("evaluateNode: draft → excluded, aboveThreshold=true, no failing entry", () => {
  const { evaluated, failing } = evaluateNode(
    "claim-001",
    "claim",
    "draft",
    0.0,
    0.7,
  );
  assertEquals(evaluated.aboveThreshold, true);
  assertEquals(evaluated.reason, "draft — excluded from readiness gate");
  assertEquals(failing, null);
});

Deno.test("evaluateNode: retired → excluded, aboveThreshold=true, no failing entry", () => {
  const { evaluated, failing } = evaluateNode(
    "claim-001",
    "claim",
    "retired",
    0.3,
    0.7,
  );
  assertEquals(evaluated.aboveThreshold, true);
  assertEquals(evaluated.reason, "retired — excluded from readiness gate");
  assertEquals(failing, null);
});

Deno.test("evaluateNode: contradicted → always fails regardless of score", () => {
  const { evaluated, failing } = evaluateNode(
    "claim-001",
    "claim",
    "contradicted",
    0.99,
    0.7,
  );
  assertEquals(evaluated.aboveThreshold, false);
  assertEquals(failing?.reason, "Contradicted — requires revision");
});

Deno.test("evaluateNode: unknown status → fails, confidence set to 0", () => {
  const { evaluated, failing } = evaluateNode(
    "claim-001",
    "claim",
    "unknown",
    0.0,
    0.7,
  );
  assertEquals(evaluated.aboveThreshold, false);
  assertEquals(evaluated.confidence, 0);
  assertEquals(failing?.reason, "Status unknown — no runtime data available");
});

Deno.test("evaluateNode: non-claim nodeType flows through unchanged", () => {
  const { evaluated } = evaluateNode("fact-001", "fact", "active", 0.9, 0.7);
  assertEquals(evaluated.nodeType, "fact");
  assertEquals(evaluated.aboveThreshold, true);
});

Deno.test("evaluateNode: threshold 0 → any active score passes", () => {
  const { evaluated } = evaluateNode("claim-001", "claim", "active", 0.0, 0.0);
  assertEquals(evaluated.aboveThreshold, true);
});

// ---------------------------------------------------------------------------
// inScope tests
// ---------------------------------------------------------------------------

Deno.test("inScope: exact match on type and target → true", () => {
  assertEquals(
    inScope("pipeline", "org/repo/main", "pipeline", "org/repo/main", false),
    true,
  );
});

Deno.test("inScope: descendant target with includeDescendants=true → true", () => {
  assertEquals(
    inScope("pipeline", "org/repo/main", "repository", "org/repo", true),
    true,
  );
});

Deno.test("inScope: descendant target with includeDescendants=false → false", () => {
  assertEquals(
    inScope("pipeline", "org/repo/main", "repository", "org/repo", false),
    false,
  );
});

Deno.test("inScope: unrelated target → false", () => {
  assertEquals(
    inScope("pipeline", "org/other/main", "repository", "org/repo", true),
    false,
  );
});

Deno.test("inScope: partial prefix without slash separator → false (no false prefix match)", () => {
  // "org/repo-extra" should NOT match scope target "org/repo"
  assertEquals(
    inScope("component", "org/repo-extra/x", "repository", "org/repo", true),
    false,
  );
});

// ---------------------------------------------------------------------------
// Output shape test (v0.2 field names)
// ---------------------------------------------------------------------------

Deno.test("v0.2 assessment shape: evaluated and failing node fields are present", () => {
  const { evaluated, failing } = evaluateNode(
    "claim-branch-protection-001",
    "claim",
    "active",
    0.5,
    0.7,
  );
  // evaluatedNodes shape
  assertEquals(typeof evaluated.nodeId, "string");
  assertEquals(typeof evaluated.nodeType, "string");
  assertEquals(typeof evaluated.confidence, "number");
  assertEquals(typeof evaluated.aboveThreshold, "boolean");
  // failingNodes shape
  assertEquals(typeof failing?.nodeId, "string");
  assertEquals(typeof failing?.confidence, "number");
  assertEquals(typeof failing?.threshold, "number");
  assertEquals(typeof failing?.reason, "string");
});

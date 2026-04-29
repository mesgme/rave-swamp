import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  confidenceLevel,
  renderClaimsTable,
  renderDashboard,
  renderReadiness,
  renderScopeTree,
  renderStatusLine,
} from "./render.ts";
import type { Claim, ConfidenceData, DashboardState, ScopeNode } from "./types.ts";

// --- Test fixtures ---

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
    confidenceScore: 0.75,
    previousScore: null,
    computedAt: "2026-04-01T10:00:00Z",
    lastValidated: "2026-04-01T10:00:00Z",
    fAvg: 1.0,
    qAvg: 1.0,
    decayFactor: 1.0,
    statusTransition: null,
    guidance: [],
    ...overrides,
  };
}

function stripAnsi(str: string): string {
  // deno-lint-ignore no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

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

// --- renderClaimsTable: confidence display ---

Deno.test("renderClaimsTable shows ─ for missing confidence", () => {
  const output = renderClaimsTable([makeClaim()], new Map());
  assertEquals(output.includes("─"), true);
});

Deno.test("renderClaimsTable shows ─ for uncomputed claim (computedAt empty)", () => {
  // Regression: ZERO_CONFIDENCE returns confidenceScore=0 with computedAt=""
  // for claims that have never been computed. Should render as ─ pending,
  // not ● 0.000 critical.
  const claims = [makeClaim()];
  const confidence = new Map([
    ["claim-test-001", makeConfidence({ confidenceScore: 0, computedAt: "" })],
  ]);
  const output = renderClaimsTable(claims, confidence);
  const stripped = stripAnsi(output);
  assertStringIncludes(stripped, "─");
  assertEquals(stripped.includes("0.000"), false);
});

Deno.test("renderClaimsTable shows ● 0.000 in critical for computed-but-zero claim", () => {
  // Distinct from uncomputed: a claim that was computed and got score 0
  // should still render with the bullet at critical.
  const claims = [makeClaim()];
  const confidence = new Map([
    ["claim-test-001", makeConfidence({ confidenceScore: 0 })],
  ]);
  const output = renderClaimsTable(claims, confidence);
  assertStringIncludes(output, "0.000");
  assertStringIncludes(output, "●");
});

Deno.test("renderClaimsTable shows score with bullet for known confidence", () => {
  const claims = [makeClaim()];
  const confidence = new Map([
    ["claim-test-001", makeConfidence({ confidenceScore: 0.85 })],
  ]);
  const output = renderClaimsTable(claims, confidence);
  assertStringIncludes(output, "● 0.850");
});

// --- renderClaimsTable: trend display ---

Deno.test("renderClaimsTable shows ↑ for positive trend", () => {
  const claims = [makeClaim()];
  const confidence = new Map([
    ["claim-test-001", makeConfidence({ confidenceScore: 0.85, previousScore: 0.7 })],
  ]);
  const output = renderClaimsTable(claims, confidence);
  assertStringIncludes(output, "↑");
});

Deno.test("renderClaimsTable shows ↓ for negative trend", () => {
  const claims = [makeClaim()];
  const confidence = new Map([
    ["claim-test-001", makeConfidence({ confidenceScore: 0.72, previousScore: 0.85 })],
  ]);
  const output = renderClaimsTable(claims, confidence);
  assertStringIncludes(output, "↓");
});

Deno.test("renderClaimsTable shows no arrow for null previousScore", () => {
  const claims = [makeClaim()];
  const confidence = new Map([
    ["claim-test-001", makeConfidence({ confidenceScore: 0.85, previousScore: null })],
  ]);
  const output = renderClaimsTable(claims, confidence);
  assertEquals(output.includes("↑"), false);
  assertEquals(output.includes("↓"), false);
});

Deno.test("renderClaimsTable shows no arrow for tiny trend diff (< 0.001)", () => {
  const claims = [makeClaim()];
  const confidence = new Map([
    ["claim-test-001", makeConfidence({ confidenceScore: 0.7505, previousScore: 0.7501 })],
  ]);
  const output = renderClaimsTable(claims, confidence);
  assertEquals(output.includes("↑"), false);
  assertEquals(output.includes("↓"), false);
});

// --- renderClaimsTable: sort order ---

Deno.test("renderClaimsTable sorts rows by category alphabetically", () => {
  const claims = [
    makeClaim({ claim_id: "claim-z-001", category: "security" }),
    makeClaim({ claim_id: "claim-a-001", category: "reliability" }),
    makeClaim({ claim_id: "claim-m-001", category: "code_quality" }),
  ];
  const output = stripAnsi(renderClaimsTable(claims, new Map()));
  const reliabilityPos = output.indexOf("reliability");
  const codeQualityPos = output.indexOf("code_quality");
  const securityPos = output.indexOf("security");
  // code_quality < reliability < security alphabetically
  assertEquals(codeQualityPos < reliabilityPos, true);
  assertEquals(reliabilityPos < securityPos, true);
});

Deno.test("renderClaimsTable stable-sorts by claim_id within same category", () => {
  const claims = [
    makeClaim({ claim_id: "claim-b-001", category: "reliability" }),
    makeClaim({ claim_id: "claim-a-001", category: "reliability" }),
  ];
  const output = stripAnsi(renderClaimsTable(claims, new Map()));
  const posA = output.indexOf("claim-a-001");
  const posB = output.indexOf("claim-b-001");
  assertEquals(posA < posB, true);
});

// --- renderClaimsTable: column layout ---

Deno.test("renderClaimsTable truncates claim IDs that exceed column width", () => {
  // ID column is 34 chars wide
  const longId = "claim-no-stale-untriaged-issues-001"; // 35 chars
  const claims = [makeClaim({ claim_id: longId })];
  const output = renderClaimsTable(claims, new Map());
  assertStringIncludes(output, "…");
  assertEquals(output.includes(longId), false);
});

Deno.test("renderClaimsTable preserves claim IDs that fit within column width", () => {
  const claims = [makeClaim({ claim_id: "claim-short-001" })];
  const output = renderClaimsTable(claims, new Map());
  assertStringIncludes(output, "claim-short-001");
  assertEquals(output.includes("…"), false);
});

Deno.test("renderClaimsTable shows placeholder for empty claims list", () => {
  const output = renderClaimsTable([], new Map());
  assertStringIncludes(output, "No claims in this scope");
});

Deno.test("renderClaimsTable header includes all column titles", () => {
  const output = renderClaimsTable([makeClaim()], new Map());
  for (const header of ["Claim", "Status", "Category", "Confidence", "Trend"]) {
    assertStringIncludes(output, header);
  }
});

Deno.test("renderClaimsTable applies green color for active claims", () => {
  const output = renderClaimsTable([makeClaim({ status: "active" })], new Map());
  // active uses GREEN (\x1b[32m)
  assertStringIncludes(output, "\x1b[32m");
});

Deno.test("renderClaimsTable applies bright-red color for contradicted claims", () => {
  const output = renderClaimsTable([makeClaim({ status: "contradicted" })], new Map());
  // contradicted uses BRIGHT_RED (\x1b[91m)
  assertStringIncludes(output, "\x1b[91m");
});

// --- renderReadiness ---

Deno.test("renderReadiness reports READY when all active claims meet threshold", () => {
  const claims = [
    makeClaim({ claim_id: "c1" }),
    makeClaim({ claim_id: "c2" }),
  ];
  const confidence = new Map([
    ["c1", makeConfidence({ claimId: "c1", confidenceScore: 0.85 })],
    ["c2", makeConfidence({ claimId: "c2", confidenceScore: 0.92 })],
  ]);
  const output = renderReadiness(claims, confidence, 0.7);
  assertStringIncludes(output, "READY");
  assertEquals(output.includes("NOT READY"), false);
});

Deno.test("renderReadiness reports NOT READY with below-threshold count", () => {
  const claims = [
    makeClaim({ claim_id: "c1" }),
    makeClaim({ claim_id: "c2" }),
  ];
  const confidence = new Map([
    ["c1", makeConfidence({ claimId: "c1", confidenceScore: 0.85 })],
    ["c2", makeConfidence({ claimId: "c2", confidenceScore: 0.4 })],
  ]);
  const output = renderReadiness(claims, confidence, 0.7);
  assertStringIncludes(output, "NOT READY");
  assertStringIncludes(output, "1 below threshold");
});

Deno.test("renderReadiness reports no-data count for uncomputed claims", () => {
  const claims = [
    makeClaim({ claim_id: "c1" }),
    makeClaim({ claim_id: "c2" }),
  ];
  const confidence = new Map([
    // c1 has placeholder (computedAt empty)
    ["c1", makeConfidence({ claimId: "c1", confidenceScore: 0, computedAt: "" })],
    // c2 missing entirely
  ]);
  const output = renderReadiness(claims, confidence, 0.7);
  assertStringIncludes(output, "NOT READY");
  assertStringIncludes(output, "2 with no data");
});

Deno.test("renderReadiness ignores non-active claims", () => {
  const claims = [
    makeClaim({ claim_id: "c1", status: "draft" }),
    makeClaim({ claim_id: "c2", status: "retired" }),
  ];
  const output = renderReadiness(claims, new Map(), 0.7);
  assertStringIncludes(output, "READY");
});

Deno.test("renderReadiness includes threshold value in output", () => {
  const claims = [makeClaim()];
  const confidence = new Map([
    ["claim-test-001", makeConfidence({ confidenceScore: 0.5 })],
  ]);
  const output = renderReadiness(claims, confidence, 0.65);
  assertStringIncludes(output, "0.65");
});

// --- renderStatusLine ---

Deno.test("renderStatusLine includes the message", () => {
  const output = renderStatusLine("Computing confidence...");
  assertStringIncludes(output, "Computing confidence...");
});

Deno.test("renderStatusLine includes the spinner glyph", () => {
  const output = renderStatusLine("Working...");
  assertStringIncludes(output, "⟳");
});

// --- renderDashboard ---

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  const root: ScopeNode = {
    type: "repository",
    target: "org/repo",
    description: "",
    children: [],
    key: "repository:org/repo",
  };
  return {
    scopeTree: root,
    flatScopes: [root],
    claims: [makeClaim({ scopeKey: "repository:org/repo" })],
    confidence: new Map(),
    selectedScopeIndex: 0,
    threshold: 0.7,
    ...overrides,
  };
}

Deno.test("renderDashboard includes title, scope section, claims table, readiness, and footer", () => {
  const output = renderDashboard(makeState());
  assertStringIncludes(output, "RAVE Dashboard");
  assertStringIncludes(output, "Scopes:");
  assertStringIncludes(output, "Claims for:");
  assertStringIncludes(output, "Readiness:");
  assertStringIncludes(output, "Navigate scopes");
  assertStringIncludes(output, "Sweep");
  assertStringIncludes(output, "Quit");
});

Deno.test("renderDashboard shows status message when provided", () => {
  const output = renderDashboard(makeState(), "Running sweep: gathering evidence...");
  assertStringIncludes(output, "Running sweep: gathering evidence...");
  assertStringIncludes(output, "⟳");
});

Deno.test("renderDashboard omits status section when no message", () => {
  const output = renderDashboard(makeState());
  assertEquals(output.includes("⟳"), false);
});

Deno.test("renderDashboard shows claim count for selected scope", () => {
  const state = makeState({
    claims: [
      makeClaim({ claim_id: "c1", scopeKey: "repository:org/repo" }),
      makeClaim({ claim_id: "c2", scopeKey: "repository:org/repo" }),
      makeClaim({ claim_id: "c3", scopeKey: "repository:org/repo" }),
    ],
  });
  const output = renderDashboard(state);
  assertStringIncludes(output, "(3 claims)");
});

Deno.test("renderDashboard shows ─ for all uncomputed claims (regression)", () => {
  // First-run regression: when no confidence has been computed yet, every
  // row should show ─ pending — not ● 0.000.
  const state = makeState({
    claims: [
      makeClaim({ claim_id: "c1", scopeKey: "repository:org/repo" }),
      makeClaim({ claim_id: "c2", scopeKey: "repository:org/repo" }),
    ],
    confidence: new Map([
      ["c1", makeConfidence({ claimId: "c1", confidenceScore: 0, computedAt: "" })],
      ["c2", makeConfidence({ claimId: "c2", confidenceScore: 0, computedAt: "" })],
    ]),
  });
  const output = stripAnsi(renderDashboard(state));
  assertEquals(output.includes("0.000"), false);
  assertStringIncludes(output, "2 with no data");
});

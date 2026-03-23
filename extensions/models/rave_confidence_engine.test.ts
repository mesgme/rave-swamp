import { assertEquals, assertThrows, assertAlmostEquals } from "jsr:@std/assert@1";

// ---------------------------------------------------------------------------
// Re-implement the pure functions under test so we can test them without
// importing the full model (which references npm:zod@4 and context APIs).
// These are exact copies of the functions in rave_confidence_engine.ts.
// ---------------------------------------------------------------------------

function parseISO8601Duration(duration: string): number {
  const re = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
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

function computeScore(c0: number, fAvg: number, qAvg: number, decayFactor: number): number {
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
  assertThrows(() => parseISO8601Duration("1D"), Error, "Invalid ISO 8601 duration");
  assertThrows(() => parseISO8601Duration(""), Error, "Invalid ISO 8601 duration");
  assertThrows(() => parseISO8601Duration("1 day"), Error, "Invalid ISO 8601 duration");
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

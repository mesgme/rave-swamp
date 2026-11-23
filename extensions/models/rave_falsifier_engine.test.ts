import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createModelTestContext } from "@systeminit/swamp-testing";

import {
  type ConditionResult,
  dispatchEvaluator,
  type EvidenceItem,
  extractJsonPath,
  model,
} from "./rave_falsifier_engine.ts";

// Tests call the model's real evaluators rather than copies of them.
const evaluate = (type: string) =>
(
  params: Record<string, unknown>,
  evidence: EvidenceItem[],
): ConditionResult => dispatchEvaluator(type, params, evidence, 0);
const evaluateBoolean = evaluate("boolean");
const evaluateThreshold = evaluate("threshold");
const evaluateRegex = evaluate("regex");
const evaluateAbsence = evaluate("absence");
const evaluateStaleness = evaluate("staleness");

function makeEvidence(
  rawData: string | null,
  timestamp?: string,
): EvidenceItem {
  return {
    evidenceId: "test-001",
    outcome: "pass",
    timestamp: timestamp ?? new Date().toISOString(),
    freshnessWindow: null,
    value: null,
    rawData,
  };
}

// ---------------------------------------------------------------------------
// evaluateBoolean
// ---------------------------------------------------------------------------

Deno.test("evaluateBoolean: field present and matches → not triggered", () => {
  const ev = makeEvidence('{"required_pull_request_reviews": true}');
  const result = evaluateBoolean({
    field: "$.required_pull_request_reviews",
    expected: true,
  }, [ev]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateBoolean: field present and does not match → triggered", () => {
  const ev = makeEvidence('{"required_pull_request_reviews": null}');
  const result = evaluateBoolean({
    field: "$.required_pull_request_reviews",
    expected: true,
  }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateBoolean: field absent from rawData → triggered", () => {
  const ev = makeEvidence("{}");
  const result = evaluateBoolean({ field: "$.missing_field", expected: true }, [
    ev,
  ]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateBoolean: rawData null → unverified, never a pass", () => {
  const ev = makeEvidence(null);
  const result = evaluateBoolean(
    { field: "$.conclusion", expected: "success" },
    [ev],
  );
  assertEquals(result.triggered, false);
  assertEquals(result.unverified, true);
});

Deno.test("evaluateBoolean: string equality check", () => {
  const ev = makeEvidence('{"conclusion": "success"}');
  const result = evaluateBoolean(
    { field: "$.conclusion", expected: "success" },
    [ev],
  );
  assertEquals(result.triggered, false);
});

Deno.test("evaluateBoolean: string mismatch → triggered", () => {
  const ev = makeEvidence('{"conclusion": "failure"}');
  const result = evaluateBoolean(
    { field: "$.conclusion", expected: "success" },
    [ev],
  );
  assertEquals(result.triggered, true);
});

// ---------------------------------------------------------------------------
// evaluateThreshold
// ---------------------------------------------------------------------------

Deno.test("evaluateThreshold: value exceeds upper bound → triggered", () => {
  const ev = makeEvidence('{"latency_ms": 500}');
  const result = evaluateThreshold({
    metric: "$.latency_ms",
    operator: ">",
    threshold: 200,
  }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateThreshold: value within bound → not triggered", () => {
  const ev = makeEvidence('{"latency_ms": 100}');
  const result = evaluateThreshold({
    metric: "$.latency_ms",
    operator: ">",
    threshold: 200,
  }, [ev]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateThreshold: value below lower bound → triggered", () => {
  const ev = makeEvidence('{"coverage": 65}');
  const result = evaluateThreshold({
    metric: "$.coverage",
    operator: "<",
    threshold: 70,
  }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateThreshold: exact equality → triggered for ==", () => {
  const ev = makeEvidence('{"exit_code": 0}');
  const result = evaluateThreshold({
    metric: "$.exit_code",
    operator: "==",
    threshold: 0,
  }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateThreshold: rawData null → unverified, never a pass", () => {
  const ev = makeEvidence(null);
  const result = evaluateThreshold({
    metric: "$.latency_ms",
    operator: ">",
    threshold: 100,
  }, [ev]);
  assertEquals(result.triggered, false);
  assertEquals(result.unverified, true);
});

// ---------------------------------------------------------------------------
// evaluateRegex
// ---------------------------------------------------------------------------

Deno.test("evaluateRegex: value matches pattern → triggered", () => {
  const ev = makeEvidence('{"status": "failure"}');
  const result = evaluateRegex({
    field: "$.status",
    pattern: "^(failure|timed_out)$",
  }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateRegex: value does not match → not triggered", () => {
  const ev = makeEvidence('{"status": "success"}');
  const result = evaluateRegex({
    field: "$.status",
    pattern: "^(failure|timed_out)$",
  }, [ev]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateRegex: array wildcard — any element matches → triggered", () => {
  const ev = makeEvidence(
    '{"workflow_runs":[{"conclusion":"success"},{"conclusion":"failure"}]}',
  );
  const result = evaluateRegex({
    field: "$.workflow_runs[*].conclusion",
    pattern: "^(failure|timed_out)$",
  }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateRegex: array wildcard — no element matches → not triggered", () => {
  const ev = makeEvidence(
    '{"workflow_runs":[{"conclusion":"success"},{"conclusion":"success"}]}',
  );
  const result = evaluateRegex({
    field: "$.workflow_runs[*].conclusion",
    pattern: "^(failure|timed_out)$",
  }, [ev]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateRegex: rawData null → unverified, never a pass", () => {
  const ev = makeEvidence(null);
  const result = evaluateRegex({ field: "$.status", pattern: "failure" }, [ev]);
  assertEquals(result.triggered, false);
  assertEquals(result.unverified, true);
});

// ---------------------------------------------------------------------------
// evaluateAbsence
// ---------------------------------------------------------------------------

Deno.test("evaluateAbsence: no evidence → triggered", () => {
  const result = evaluateAbsence({}, []);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateAbsence: evidence present, no grace period → not triggered", () => {
  const result = evaluateAbsence({}, [makeEvidence(null)]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateAbsence: evidence within grace period → not triggered", () => {
  const freshTimestamp = new Date().toISOString();
  const result = evaluateAbsence({ grace_period: "PT1H" }, [
    makeEvidence(null, freshTimestamp),
  ]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateAbsence: evidence beyond grace period → triggered", () => {
  const oldTimestamp = new Date(Date.now() - 2 * 3600 * 1000).toISOString(); // 2h ago
  const result = evaluateAbsence({ grace_period: "PT1H" }, [
    makeEvidence(null, oldTimestamp),
  ]);
  assertEquals(result.triggered, true);
});

// ---------------------------------------------------------------------------
// evaluateStaleness
// ---------------------------------------------------------------------------

Deno.test("evaluateStaleness: no evidence → triggered", () => {
  const result = evaluateStaleness({ max_age: "P1D" }, []);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateStaleness: fresh evidence → not triggered", () => {
  const freshTimestamp = new Date().toISOString();
  const result = evaluateStaleness({ max_age: "P1D" }, [
    makeEvidence(null, freshTimestamp),
  ]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateStaleness: all evidence older than max_age → triggered", () => {
  const oldTimestamp = new Date(Date.now() - 2 * 86400 * 1000).toISOString(); // 2 days ago
  const result = evaluateStaleness({ max_age: "P1D" }, [
    makeEvidence(null, oldTimestamp),
  ]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateStaleness: mixed fresh and stale — has fresh → not triggered", () => {
  const fresh = new Date().toISOString();
  const stale = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
  const result = evaluateStaleness({ max_age: "P1D" }, [
    makeEvidence(null, fresh),
    makeEvidence(null, stale),
  ]);
  assertEquals(result.triggered, false);
});

// ---------------------------------------------------------------------------
// extractJsonPath
// ---------------------------------------------------------------------------

Deno.test("extractJsonPath: simple field access", () => {
  assertEquals(extractJsonPath({ foo: 42 }, "$.foo"), 42);
});

Deno.test("extractJsonPath: nested field access", () => {
  assertEquals(extractJsonPath({ a: { b: "hello" } }, "$.a.b"), "hello");
});

Deno.test("extractJsonPath: array wildcard returns array of values", () => {
  const data = { items: [{ val: 1 }, { val: 2 }, { val: 3 }] };
  const result = extractJsonPath(data, "$.items[*].val") as number[];
  assertEquals(result, [1, 2, 3]);
});

Deno.test("extractJsonPath: array index access", () => {
  assertEquals(extractJsonPath({ arr: ["a", "b", "c"] }, "$.arr[1]"), "b");
});

Deno.test("extractJsonPath: missing field returns undefined", () => {
  assertEquals(extractJsonPath({ foo: 1 }, "$.bar"), undefined);
});

Deno.test("extractJsonPath: throws if path does not start with $", () => {
  assertThrows(
    () => extractJsonPath({}, "foo.bar"),
    Error,
    "JSONPath must start with $",
  );
});

// ---------------------------------------------------------------------------
// Unverifiable evidence fails closed
// ---------------------------------------------------------------------------

Deno.test("evaluateBoolean: violation in readable evidence triggers even when other evidence is unreadable", () => {
  const result = evaluateBoolean(
    { field: "$.conclusion", expected: "success" },
    [makeEvidence(null), makeEvidence('{"conclusion": "failure"}')],
  );
  assertEquals(result.triggered, true);
  assertEquals(result.unverified, undefined);
});

Deno.test("composite OR: unverified sub-condition and no hit → unverified", () => {
  const result = dispatchEvaluator(
    "composite",
    {
      operator: "OR",
      sub_conditions: [
        {
          type: "boolean",
          parameters: { field: "$.conclusion", expected: "success" },
        },
        { type: "staleness", parameters: { max_age: "P1D" } },
      ],
    },
    [makeEvidence(null)],
    0,
  );
  assertEquals(result.triggered, false);
  assertEquals(result.unverified, true);
});

Deno.test("composite AND: a verified false sub-condition decides it despite an unverified one", () => {
  const result = dispatchEvaluator(
    "composite",
    {
      operator: "AND",
      sub_conditions: [
        {
          type: "boolean",
          parameters: { field: "$.conclusion", expected: "success" },
        },
        { type: "staleness", parameters: { max_age: "P1D" } },
      ],
    },
    [makeEvidence(null)],
    0,
  );
  assertEquals(result.triggered, false);
  assertEquals(result.unverified, undefined);
});

async function runEvaluate(evidence: EvidenceItem[]) {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: {
      falsifierId: "falsifier-test-001",
      conditionType: "boolean",
      condition: '{"field":"$.conclusion","expected":"success"}',
    },
    methodName: "evaluate",
  });
  let error: unknown = null;
  try {
    await model.methods.evaluate.execute({ evidence }, context);
  } catch (e) {
    error = e;
  }
  return { error, written: getWrittenResources() };
}

Deno.test("evaluate: failed evidence without rawData records unverified and fails the step", async () => {
  // The case that silently passed: the CVE scan failed, but the workflow
  // passed rawData: null and the falsifier recorded triggered: false.
  const ev = { ...makeEvidence(null), outcome: "fail" as const };
  const { error, written } = await runEvaluate([ev]);
  assertEquals(written.length, 1);
  assertEquals(written[0].data.verdict, "unverified");
  assertEquals(written[0].data.triggered, false);
  assertEquals(error instanceof Error, true);
});

Deno.test("evaluate: readable failing evidence records triggered and does not throw", async () => {
  const { error, written } = await runEvaluate([
    makeEvidence('{"conclusion": "failure"}'),
  ]);
  assertEquals(error, null);
  assertEquals(written[0].data.verdict, "triggered");
  assertEquals(written[0].data.triggered, true);
});

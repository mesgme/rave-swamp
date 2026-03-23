import { assertEquals, assertThrows } from "jsr:@std/assert@1";

// ---------------------------------------------------------------------------
// Re-implement the pure functions under test (exact copies from the model).
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

function extractJsonPath(data: unknown, path: string): unknown {
  if (!path.startsWith("$")) throw new Error(`JSONPath must start with $: ${path}`);
  const parts = path
    .slice(1)
    .replace(/\[(\*|\d+)\]/g, ".$1")
    .split(".")
    .filter((p) => p.length > 0);

  function walk(node: unknown, segments: string[]): unknown {
    if (segments.length === 0) return node;
    const [head, ...rest] = segments;
    if (head === "*") {
      if (!Array.isArray(node)) return undefined;
      return node.map((item) => walk(item, rest));
    }
    const index = Number(head);
    if (!isNaN(index) && Array.isArray(node)) return walk((node as unknown[])[index], rest);
    if (node !== null && typeof node === "object" && !Array.isArray(node)) {
      return walk((node as Record<string, unknown>)[head], rest);
    }
    return undefined;
  }
  return walk(data, parts);
}

function flatten(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [value];
  return value.flatMap(flatten);
}

type EvidenceItem = {
  evidenceId: string;
  outcome: "pass" | "fail" | "inconclusive";
  timestamp: string;
  freshnessWindow: string | null;
  value: number | null;
  rawData: string | null;
};

interface ConditionResult {
  triggered: boolean;
  detail: string;
}

function evaluateBoolean(params: Record<string, unknown>, evidence: EvidenceItem[]): ConditionResult {
  const field = params.field as string;
  const expected = params.expected;
  for (const ev of evidence) {
    if (!ev.rawData) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(ev.rawData); } catch { continue; }
    const raw = extractJsonPath(parsed, field);
    const values = flatten(raw);
    for (const v of values) {
      const equal = v === expected ||
        String(v) === String(expected) ||
        (expected === true && v !== null && v !== undefined && v !== false);
      if (!equal) return { triggered: true, detail: `${field} = ${JSON.stringify(v)}, expected ${JSON.stringify(expected)} (triggered)` };
    }
    if (values.length === 0) return { triggered: true, detail: `${field} not present in evidence (triggered)` };
  }
  return { triggered: false, detail: `${field} matches expected value ${JSON.stringify(expected)}` };
}

function evaluateThreshold(params: Record<string, unknown>, evidence: EvidenceItem[]): ConditionResult {
  const metric = params.metric as string;
  const operator = params.operator as string;
  const threshold = params.threshold as number;
  for (const ev of evidence) {
    if (!ev.rawData) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(ev.rawData); } catch { continue; }
    const values = flatten(extractJsonPath(parsed, metric));
    for (const v of values) {
      const num = typeof v === "number" ? v : parseFloat(String(v));
      if (isNaN(num)) continue;
      let hit = false;
      switch (operator) {
        case ">": hit = num > threshold; break;
        case ">=": hit = num >= threshold; break;
        case "<": hit = num < threshold; break;
        case "<=": hit = num <= threshold; break;
        case "==": hit = num === threshold; break;
        case "!=": hit = num !== threshold; break;
      }
      if (hit) return { triggered: true, detail: `${metric} = ${num} ${operator} ${threshold} (triggered)` };
    }
  }
  return { triggered: false, detail: `No threshold violation` };
}

function evaluateRegex(params: Record<string, unknown>, evidence: EvidenceItem[]): ConditionResult {
  const field = params.field as string;
  const pattern = params.pattern as string;
  const flags = (params.flags as string | undefined) ?? "";
  const re = new RegExp(pattern, flags);
  for (const ev of evidence) {
    if (!ev.rawData) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(ev.rawData); } catch { continue; }
    const values = flatten(extractJsonPath(parsed, field));
    for (const v of values) {
      if (re.test(String(v))) return { triggered: true, detail: `${field} value "${v}" matches /${pattern}/${flags}` };
    }
  }
  return { triggered: false, detail: `No match for /${pattern}/${flags}` };
}

function evaluateAbsence(params: Record<string, unknown>, evidence: EvidenceItem[]): ConditionResult {
  if (evidence.length === 0) return { triggered: true, detail: "No evidence present (triggered)" };
  const gracePeriod = params.grace_period as string | undefined;
  if (!gracePeriod) return { triggered: false, detail: `${evidence.length} evidence item(s) present` };
  const graceSeconds = parseISO8601Duration(gracePeriod);
  const now = Date.now();
  const mostRecent = Math.max(...evidence.map((ev) => new Date(ev.timestamp).getTime()));
  const ageSeconds = (now - mostRecent) / 1000;
  if (ageSeconds > graceSeconds) return { triggered: true, detail: `Evidence too old (triggered)` };
  return { triggered: false, detail: "Evidence present within grace period" };
}

function evaluateStaleness(params: Record<string, unknown>, evidence: EvidenceItem[]): ConditionResult {
  const maxAge = params.max_age as string;
  const maxAgeSeconds = parseISO8601Duration(maxAge);
  const now = Date.now();
  if (evidence.length === 0) return { triggered: true, detail: "No evidence (triggered)" };
  const allStale = evidence.every((ev) => (now - new Date(ev.timestamp).getTime()) / 1000 > maxAgeSeconds);
  return allStale
    ? { triggered: true, detail: `All evidence older than ${maxAge} (triggered)` }
    : { triggered: false, detail: `Evidence within staleness window` };
}

function makeEvidence(rawData: string | null, timestamp?: string): EvidenceItem {
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
  const result = evaluateBoolean({ field: "$.required_pull_request_reviews", expected: true }, [ev]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateBoolean: field present and does not match → triggered", () => {
  const ev = makeEvidence('{"required_pull_request_reviews": null}');
  const result = evaluateBoolean({ field: "$.required_pull_request_reviews", expected: true }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateBoolean: field absent from rawData → triggered", () => {
  const ev = makeEvidence('{}');
  const result = evaluateBoolean({ field: "$.missing_field", expected: true }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateBoolean: rawData null → not triggered (skipped)", () => {
  const ev = makeEvidence(null);
  const result = evaluateBoolean({ field: "$.conclusion", expected: "success" }, [ev]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateBoolean: string equality check", () => {
  const ev = makeEvidence('{"conclusion": "success"}');
  const result = evaluateBoolean({ field: "$.conclusion", expected: "success" }, [ev]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateBoolean: string mismatch → triggered", () => {
  const ev = makeEvidence('{"conclusion": "failure"}');
  const result = evaluateBoolean({ field: "$.conclusion", expected: "success" }, [ev]);
  assertEquals(result.triggered, true);
});

// ---------------------------------------------------------------------------
// evaluateThreshold
// ---------------------------------------------------------------------------

Deno.test("evaluateThreshold: value exceeds upper bound → triggered", () => {
  const ev = makeEvidence('{"latency_ms": 500}');
  const result = evaluateThreshold({ metric: "$.latency_ms", operator: ">", threshold: 200 }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateThreshold: value within bound → not triggered", () => {
  const ev = makeEvidence('{"latency_ms": 100}');
  const result = evaluateThreshold({ metric: "$.latency_ms", operator: ">", threshold: 200 }, [ev]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateThreshold: value below lower bound → triggered", () => {
  const ev = makeEvidence('{"coverage": 65}');
  const result = evaluateThreshold({ metric: "$.coverage", operator: "<", threshold: 70 }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateThreshold: exact equality → triggered for ==", () => {
  const ev = makeEvidence('{"exit_code": 0}');
  const result = evaluateThreshold({ metric: "$.exit_code", operator: "==", threshold: 0 }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateThreshold: rawData null → not triggered", () => {
  const ev = makeEvidence(null);
  const result = evaluateThreshold({ metric: "$.latency_ms", operator: ">", threshold: 100 }, [ev]);
  assertEquals(result.triggered, false);
});

// ---------------------------------------------------------------------------
// evaluateRegex
// ---------------------------------------------------------------------------

Deno.test("evaluateRegex: value matches pattern → triggered", () => {
  const ev = makeEvidence('{"status": "failure"}');
  const result = evaluateRegex({ field: "$.status", pattern: "^(failure|timed_out)$" }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateRegex: value does not match → not triggered", () => {
  const ev = makeEvidence('{"status": "success"}');
  const result = evaluateRegex({ field: "$.status", pattern: "^(failure|timed_out)$" }, [ev]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateRegex: array wildcard — any element matches → triggered", () => {
  const ev = makeEvidence('{"workflow_runs":[{"conclusion":"success"},{"conclusion":"failure"}]}');
  const result = evaluateRegex({ field: "$.workflow_runs[*].conclusion", pattern: "^(failure|timed_out)$" }, [ev]);
  assertEquals(result.triggered, true);
});

Deno.test("evaluateRegex: array wildcard — no element matches → not triggered", () => {
  const ev = makeEvidence('{"workflow_runs":[{"conclusion":"success"},{"conclusion":"success"}]}');
  const result = evaluateRegex({ field: "$.workflow_runs[*].conclusion", pattern: "^(failure|timed_out)$" }, [ev]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateRegex: rawData null → not triggered", () => {
  const ev = makeEvidence(null);
  const result = evaluateRegex({ field: "$.status", pattern: "failure" }, [ev]);
  assertEquals(result.triggered, false);
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
  const result = evaluateAbsence({ grace_period: "PT1H" }, [makeEvidence(null, freshTimestamp)]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateAbsence: evidence beyond grace period → triggered", () => {
  const oldTimestamp = new Date(Date.now() - 2 * 3600 * 1000).toISOString(); // 2h ago
  const result = evaluateAbsence({ grace_period: "PT1H" }, [makeEvidence(null, oldTimestamp)]);
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
  const result = evaluateStaleness({ max_age: "P1D" }, [makeEvidence(null, freshTimestamp)]);
  assertEquals(result.triggered, false);
});

Deno.test("evaluateStaleness: all evidence older than max_age → triggered", () => {
  const oldTimestamp = new Date(Date.now() - 2 * 86400 * 1000).toISOString(); // 2 days ago
  const result = evaluateStaleness({ max_age: "P1D" }, [makeEvidence(null, oldTimestamp)]);
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
  assertThrows(() => extractJsonPath({}, "foo.bar"), Error, "JSONPath must start with $");
});

import { assertEquals } from "jsr:@std/assert@1";
import { classifyPaths } from "./rave_diff_evidence.ts";

const GUARDED_GLOBS = [
  "rave/claims/**",
  "rave/scopes/**",
  "workflows/workflow-*.yaml",
  "extensions/models/rave_*.ts",
];

Deno.test("classifyPaths: no changes → pass", () => {
  const result = classifyPaths([], GUARDED_GLOBS);
  assertEquals(result.outcome, "pass");
  assertEquals(result.guardedChanged, []);
  assertEquals(result.nonGuardedChanged, []);
});

Deno.test("classifyPaths: only non-guarded changes → pass", () => {
  const result = classifyPaths(["src/main.ts", "README.md"], GUARDED_GLOBS);
  assertEquals(result.outcome, "pass");
  assertEquals(result.nonGuardedChanged, ["src/main.ts", "README.md"]);
  assertEquals(result.guardedChanged, []);
});

Deno.test("classifyPaths: only guarded changes → inconclusive", () => {
  const result = classifyPaths(
    ["rave/claims/claim-test-001.yaml", "extensions/models/rave_ci_evidence.ts"],
    GUARDED_GLOBS,
  );
  assertEquals(result.outcome, "inconclusive");
  assertEquals(result.guardedChanged.length, 2);
  assertEquals(result.nonGuardedChanged, []);
});

Deno.test("classifyPaths: mixed guarded and non-guarded → fail", () => {
  const result = classifyPaths(
    ["rave/claims/claim-test-001.yaml", "src/app.ts"],
    GUARDED_GLOBS,
  );
  assertEquals(result.outcome, "fail");
  assertEquals(result.guardedChanged, ["rave/claims/claim-test-001.yaml"]);
  assertEquals(result.nonGuardedChanged, ["src/app.ts"]);
});

Deno.test("classifyPaths: workflow yaml matches guarded glob", () => {
  const result = classifyPaths(
    ["workflows/workflow-abc123.yaml"],
    GUARDED_GLOBS,
  );
  assertEquals(result.outcome, "inconclusive");
  assertEquals(result.guardedChanged, ["workflows/workflow-abc123.yaml"]);
});

Deno.test("classifyPaths: rave_*.ts model file matches guarded glob", () => {
  const result = classifyPaths(
    ["extensions/models/rave_confidence_engine.ts"],
    GUARDED_GLOBS,
  );
  assertEquals(result.outcome, "inconclusive");
});

Deno.test("classifyPaths: non-rave model file does not match guarded glob", () => {
  const result = classifyPaths(
    ["extensions/models/my_custom_model.ts"],
    GUARDED_GLOBS,
  );
  assertEquals(result.outcome, "pass");
});

Deno.test("classifyPaths: rave/scopes matches guarded glob", () => {
  const result = classifyPaths(
    ["rave/scopes/rave-swamp.yaml", "bin/rave-dashboard.ts"],
    GUARDED_GLOBS,
  );
  assertEquals(result.outcome, "fail");
});

Deno.test("classifyPaths: fail result has failureReason and remediation", () => {
  const result = classifyPaths(
    ["rave/claims/claim-test-001.yaml", "src/app.ts"],
    GUARDED_GLOBS,
  );
  assertEquals(result.outcome, "fail");
  assertEquals(typeof result.failureReason, "string");
  assertEquals(typeof result.remediation, "string");
});

Deno.test("classifyPaths: pass result has null failureReason and remediation", () => {
  const result = classifyPaths(["src/app.ts"], GUARDED_GLOBS);
  assertEquals(result.failureReason, null);
  assertEquals(result.remediation, null);
});

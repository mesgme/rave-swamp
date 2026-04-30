import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { createModelTestContext } from "@systeminit/swamp-testing";
import { model } from "./rave_ci_evidence.ts";

const BASE_GLOBAL_ARGS = {
  evidenceId: "evidence-ci-test-001",
  repo: "org/repo",
  workflowName: "ci.yml",
  branch: "main",
};

function makeRun(conclusion: string | null) {
  return {
    id: 12345,
    name: "CI",
    display_title: "CI",
    status: "completed",
    conclusion,
    head_branch: "main",
    head_sha: "abc1234def",
    created_at: new Date().toISOString(),
  };
}

function mockFetch(
  status: number,
  body: unknown,
): () => Promise<Response> {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
}

Deno.test("ci-evidence: pass outcome → failureReason and remediation are null", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch(200, {
    workflow_runs: [makeRun("success")],
  });
  try {
    const { context, getWrittenResources } = createModelTestContext({
      globalArgs: BASE_GLOBAL_ARGS,
      methodName: "gather",
    });
    await model.methods.gather.execute({ githubToken: "tok" }, context);
    const [res] = getWrittenResources();
    assertEquals(res.data.outcome, "pass");
    assertEquals(res.data.failureReason, null);
    assertEquals(res.data.remediation, null);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("ci-evidence: fail outcome → failureReason and remediation are non-null strings", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch(200, {
    workflow_runs: [makeRun("failure")],
  });
  try {
    const { context, getWrittenResources } = createModelTestContext({
      globalArgs: BASE_GLOBAL_ARGS,
      methodName: "gather",
    });
    await model.methods.gather.execute({ githubToken: "tok" }, context);
    const [res] = getWrittenResources();
    assertEquals(res.data.outcome, "fail");
    assertExists(res.data.failureReason);
    assertExists(res.data.remediation);
    assertEquals(typeof res.data.failureReason, "string");
    assertEquals(typeof res.data.remediation, "string");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("ci-evidence: inconclusive (no runs) → failureReason and remediation are null", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch(200, { workflow_runs: [] });
  try {
    const { context, getWrittenResources } = createModelTestContext({
      globalArgs: BASE_GLOBAL_ARGS,
      methodName: "gather",
    });
    await model.methods.gather.execute({ githubToken: "tok" }, context);
    const [res] = getWrittenResources();
    assertEquals(res.data.outcome, "inconclusive");
    assertEquals(res.data.failureReason, null);
    assertEquals(res.data.remediation, null);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("ci-evidence: 404 (workflow not found) → failureReason and remediation are null", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch(404, {});
  try {
    const { context, getWrittenResources } = createModelTestContext({
      globalArgs: BASE_GLOBAL_ARGS,
      methodName: "gather",
    });
    await model.methods.gather.execute({ githubToken: "tok" }, context);
    const [res] = getWrittenResources();
    assertEquals(res.data.outcome, "inconclusive");
    assertEquals(res.data.failureReason, null);
    assertEquals(res.data.remediation, null);
  } finally {
    globalThis.fetch = original;
  }
});

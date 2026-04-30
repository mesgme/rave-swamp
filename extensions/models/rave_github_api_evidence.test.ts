import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { createModelTestContext } from "@systeminit/swamp-testing";
import { model } from "./rave_github_api_evidence.ts";

const BASE_GLOBAL_ARGS = {
  evidenceId: "evidence-test-001",
  repo: "org/repo",
  endpoint: "/branches/main/protection",
  successField: "$.required_status_checks.strict",
};

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

Deno.test("github-api-evidence: pass outcome → failureReason and remediation are null", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch(200, { required_status_checks: { strict: true } });
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

Deno.test("github-api-evidence: fail outcome → failureReason and remediation are non-null strings", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch(200, { required_status_checks: { strict: false } });
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

Deno.test("github-api-evidence: 404 endpoint → failureReason and remediation are null", async () => {
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

Deno.test("github-api-evidence: network error → failureReason and remediation are null", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("network failure"));
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

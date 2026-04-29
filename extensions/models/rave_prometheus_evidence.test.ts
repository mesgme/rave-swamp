import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { createModelTestContext } from "@systeminit/swamp-testing";
import { model } from "./rave_prometheus_evidence.ts";

const BASE_GLOBAL_ARGS = {
  evidenceId: "evidence-prom-test-001",
  baseUrl: "http://prometheus.example.com",
  query: "up",
  threshold: 1,
  operator: ">=" as const,
};

function scalarResponse(value: number) {
  return {
    status: "success",
    data: { resultType: "scalar", result: [Date.now() / 1000, String(value)] },
  };
}

function mockFetch(body: unknown, status = 200): () => Promise<Response> {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
}

Deno.test("prometheus-evidence: pass outcome → failureReason and remediation are null", async () => {
  const original = globalThis.fetch;
  // value=0.5, threshold=1, operator=">=" → 0.5>=1 false → evaluateThreshold=false → pass
  globalThis.fetch = mockFetch(scalarResponse(0.5));
  try {
    const { context, getWrittenResources } = createModelTestContext({
      globalArgs: { ...BASE_GLOBAL_ARGS, threshold: 1, operator: ">=" },
      methodName: "gather",
    });
    await model.methods.gather.execute({ prometheusToken: "" }, context);
    const [res] = getWrittenResources();
    assertEquals(res.data.outcome, "pass");
    assertEquals(res.data.failureReason, null);
    assertEquals(res.data.remediation, null);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("prometheus-evidence: fail outcome → failureReason and remediation are non-null strings", async () => {
  const original = globalThis.fetch;
  // value=2, threshold=1, operator=">=" → 2>=1 true → evaluateThreshold=true → fail
  globalThis.fetch = mockFetch(scalarResponse(2));
  try {
    const { context, getWrittenResources } = createModelTestContext({
      globalArgs: { ...BASE_GLOBAL_ARGS, threshold: 1, operator: ">=" },
      methodName: "gather",
    });
    await model.methods.gather.execute({ prometheusToken: "" }, context);
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

Deno.test("prometheus-evidence: no data returned → failureReason and remediation are null", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch({
    status: "success",
    data: { resultType: "vector", result: [] },
  });
  try {
    const { context, getWrittenResources } = createModelTestContext({
      globalArgs: BASE_GLOBAL_ARGS,
      methodName: "gather",
    });
    await model.methods.gather.execute({ prometheusToken: "" }, context);
    const [res] = getWrittenResources();
    assertEquals(res.data.outcome, "inconclusive");
    assertEquals(res.data.failureReason, null);
    assertEquals(res.data.remediation, null);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("prometheus-evidence: network error → failureReason and remediation are null", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("connection refused"));
  try {
    const { context, getWrittenResources } = createModelTestContext({
      globalArgs: BASE_GLOBAL_ARGS,
      methodName: "gather",
    });
    await model.methods.gather.execute({ prometheusToken: "" }, context);
    const [res] = getWrittenResources();
    assertEquals(res.data.outcome, "inconclusive");
    assertEquals(res.data.failureReason, null);
    assertEquals(res.data.remediation, null);
  } finally {
    globalThis.fetch = original;
  }
});

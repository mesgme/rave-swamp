import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { createModelTestContext } from "@systeminit/swamp-testing";
import { model } from "./rave_service_descriptor.ts";

// The test harness types written data as `unknown`; cast to access typed fields.
type Descriptor = {
  outcome: string;
  summary: string;
  timestamp: string;
  attestedAt: string;
  isStale: boolean;
  rawData: string;
  failureReason: string | null;
  remediation: string | null;
  criticalDepsDocumented: boolean;
  undocumentedCriticalDeps: string[];
  sloComplete: boolean;
  incompleteEndpoints: string[];
};

const BASE_GLOBAL_ARGS = {
  serviceId: "rave-swamp",
  repo: "mesgme/rave-swamp",
};

const OWNER = {
  name: "Mark Ellens",
  team: "rave-core",
  confirmedAt: "2026-06-24T00:00:00.000Z",
};

const CRITICAL_DEP_DOCUMENTED = {
  name: "github-api",
  type: "external-api" as const,
  criticality: "critical" as const,
  sla: "99.9% availability per month",
  fallbackPlan: "Queue writes and replay once API recovers",
};

const STANDARD_DEP_UNDOCUMENTED = {
  name: "some-library",
  type: "library" as const,
  criticality: "standard" as const,
  // no sla or fallbackPlan — standard deps are exempt
};

const SLO_COMPLETE = {
  endpoint: "/api/health",
  target: 0.999,
  window: "30d",
};

// ---------------------------------------------------------------------------
// Pass case
// ---------------------------------------------------------------------------

Deno.test("service-descriptor: pass — owner + documented critical deps + complete SLOs", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: BASE_GLOBAL_ARGS,
    methodName: "declare",
  });

  await model.methods.declare.execute(
    {
      owner: OWNER,
      dependencies: [CRITICAL_DEP_DOCUMENTED, STANDARD_DEP_UNDOCUMENTED],
      slos: [SLO_COMPLETE],
      attestedBy: "mellens",
    },
    context,
  );

  const [res] = getWrittenResources();
  const data = res.data as Descriptor;
  assertEquals(data.outcome, "pass");
  assertEquals(data.criticalDepsDocumented, true);
  assertEquals(data.undocumentedCriticalDeps, []);
  assertEquals(data.sloComplete, true);
  assertEquals(data.incompleteEndpoints, []);
  assertEquals(data.failureReason, null);
  assertEquals(data.remediation, null);
  assertEquals(data.isStale, false);

  // timestamp must equal attestedAt (staleness falsifier depends on this)
  assertExists(data.attestedAt);
  assertEquals(data.timestamp, data.attestedAt);

  // rawData must be valid JSON containing the derived booleans
  const raw = JSON.parse(data.rawData);
  assertEquals(raw.criticalDepsDocumented, true);
  assertEquals(raw.sloComplete, true);
  assertEquals(raw.outcome, "pass");
});

// ---------------------------------------------------------------------------
// Fail: undocumented critical dep
// ---------------------------------------------------------------------------

Deno.test("service-descriptor: fail — critical dep missing fallbackPlan", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: BASE_GLOBAL_ARGS,
    methodName: "declare",
  });

  await model.methods.declare.execute(
    {
      owner: OWNER,
      dependencies: [
        {
          name: "github-api",
          type: "external-api",
          criticality: "critical",
          sla: "99.9% availability per month",
          // fallbackPlan omitted — should trigger undocumented
        },
      ],
      slos: [SLO_COMPLETE],
      attestedBy: "mellens",
    },
    context,
  );

  const [res] = getWrittenResources();
  const data = res.data as Descriptor;
  assertEquals(data.outcome, "fail");
  assertEquals(data.criticalDepsDocumented, false);
  assertEquals(data.undocumentedCriticalDeps, ["github-api"]);
  assertEquals(data.sloComplete, true); // SLO is fine
  assertExists(data.failureReason);
  assertExists(data.remediation);
  assertEquals(typeof data.failureReason, "string");
  assertEquals(typeof data.remediation, "string");

  // rawData reflects the failure
  const raw = JSON.parse(data.rawData);
  assertEquals(raw.criticalDepsDocumented, false);
  assertEquals(raw.undocumentedCriticalDeps, ["github-api"]);
});

Deno.test("service-descriptor: fail — critical dep missing both sla and fallbackPlan", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: BASE_GLOBAL_ARGS,
    methodName: "declare",
  });

  await model.methods.declare.execute(
    {
      owner: OWNER,
      dependencies: [
        {
          name: "postgres",
          type: "database",
          criticality: "critical",
          // sla and fallbackPlan both missing
        },
      ],
      slos: [SLO_COMPLETE],
      attestedBy: "mellens",
    },
    context,
  );

  const [res] = getWrittenResources();
  const data = res.data as Descriptor;
  assertEquals(data.outcome, "fail");
  assertEquals(data.criticalDepsDocumented, false);
  assertEquals(data.undocumentedCriticalDeps, ["postgres"]);
});

// ---------------------------------------------------------------------------
// Fail: incomplete SLO
// ---------------------------------------------------------------------------

Deno.test("service-descriptor: fail — SLO entry missing window", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: BASE_GLOBAL_ARGS,
    methodName: "declare",
  });

  await model.methods.declare.execute(
    {
      owner: OWNER,
      dependencies: [CRITICAL_DEP_DOCUMENTED],
      slos: [
        {
          endpoint: "/api/health",
          target: 0.999,
          // window omitted — incomplete
        },
      ],
      attestedBy: "mellens",
    },
    context,
  );

  const [res] = getWrittenResources();
  const data = res.data as Descriptor;
  assertEquals(data.outcome, "fail");
  assertEquals(data.sloComplete, false);
  assertEquals(data.incompleteEndpoints, ["/api/health"]);
  assertEquals(data.criticalDepsDocumented, true); // deps are fine
  assertExists(data.failureReason);

  const raw = JSON.parse(data.rawData);
  assertEquals(raw.sloComplete, false);
  assertEquals(raw.incompleteEndpoints, ["/api/health"]);
});

Deno.test("service-descriptor: fail — SLO entry missing target", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: BASE_GLOBAL_ARGS,
    methodName: "declare",
  });

  await model.methods.declare.execute(
    {
      owner: OWNER,
      dependencies: [CRITICAL_DEP_DOCUMENTED],
      slos: [
        {
          endpoint: "/api/search",
          // target omitted
          window: "30d",
        },
      ],
      attestedBy: "mellens",
    },
    context,
  );

  const [res] = getWrittenResources();
  const data = res.data as Descriptor;
  assertEquals(data.outcome, "fail");
  assertEquals(data.sloComplete, false);
  assertEquals(data.incompleteEndpoints, ["/api/search"]);
});

// ---------------------------------------------------------------------------
// Standard-criticality deps are exempt from documentation requirement
// ---------------------------------------------------------------------------

Deno.test("service-descriptor: standard dep without sla/fallbackPlan does not affect criticalDepsDocumented", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: BASE_GLOBAL_ARGS,
    methodName: "declare",
  });

  await model.methods.declare.execute(
    {
      owner: OWNER,
      dependencies: [
        CRITICAL_DEP_DOCUMENTED, // critical — fully documented
        STANDARD_DEP_UNDOCUMENTED, // standard — undocumented, but that's fine
        {
          name: "another-lib",
          type: "library",
          criticality: "standard",
          // no sla or fallbackPlan
        },
      ],
      slos: [SLO_COMPLETE],
      attestedBy: "mellens",
    },
    context,
  );

  const [res] = getWrittenResources();
  const data = res.data as Descriptor;
  assertEquals(data.outcome, "pass");
  assertEquals(data.criticalDepsDocumented, true);
  assertEquals(data.undocumentedCriticalDeps, []);
});

// ---------------------------------------------------------------------------
// Both fail conditions simultaneously
// ---------------------------------------------------------------------------

Deno.test("service-descriptor: fail — both undocumented critical dep and incomplete SLO", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: BASE_GLOBAL_ARGS,
    methodName: "declare",
  });

  await model.methods.declare.execute(
    {
      owner: OWNER,
      dependencies: [
        {
          name: "redis",
          type: "database",
          criticality: "critical",
          // sla and fallbackPlan both missing
        },
      ],
      slos: [
        {
          endpoint: "/api/write",
          target: 0.99,
          // window missing
        },
      ],
      attestedBy: "mellens",
    },
    context,
  );

  const [res] = getWrittenResources();
  const data = res.data as Descriptor;
  assertEquals(data.outcome, "fail");
  assertEquals(data.criticalDepsDocumented, false);
  assertEquals(data.sloComplete, false);
  assertExists(data.failureReason);
  // summary should mention both issues
  assertEquals(
    data.summary.includes("undocumented critical deps"),
    true,
  );
  assertEquals(
    data.summary.includes("incomplete SLO entries"),
    true,
  );
});

// ---------------------------------------------------------------------------
// Empty arrays (no deps, no SLOs) — should pass (nothing to fail)
// ---------------------------------------------------------------------------

Deno.test("service-descriptor: pass — no dependencies, no SLOs", async () => {
  const { context, getWrittenResources } = createModelTestContext({
    globalArgs: BASE_GLOBAL_ARGS,
    methodName: "declare",
  });

  await model.methods.declare.execute(
    {
      owner: OWNER,
      dependencies: [],
      slos: [],
      attestedBy: "mellens",
    },
    context,
  );

  const [res] = getWrittenResources();
  const data = res.data as Descriptor;
  assertEquals(data.outcome, "pass");
  assertEquals(data.criticalDepsDocumented, true);
  assertEquals(data.sloComplete, true);
  assertEquals(data.undocumentedCriticalDeps, []);
  assertEquals(data.incompleteEndpoints, []);
});

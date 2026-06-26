import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  buildDeclarePayload,
  type DescriptorFile,
  getPendingQuestions,
  isStale,
  loadQuestions,
  parseDurationMs,
  type Question,
} from "./rave-assess.ts";

// ---------------------------------------------------------------------------
// parseDurationMs
// ---------------------------------------------------------------------------

Deno.test("parseDurationMs: P90D", () => {
  assertEquals(parseDurationMs("P90D"), 90 * 24 * 60 * 60 * 1000);
});

Deno.test("parseDurationMs: P1D", () => {
  assertEquals(parseDurationMs("P1D"), 24 * 60 * 60 * 1000);
});

Deno.test("parseDurationMs: P30D", () => {
  assertEquals(parseDurationMs("P30D"), 30 * 24 * 60 * 60 * 1000);
});

Deno.test("parseDurationMs: unsupported format throws", () => {
  let threw = false;
  try {
    parseDurationMs("PT1H");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

// ---------------------------------------------------------------------------
// isStale
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-26T00:00:00.000Z");

Deno.test("isStale: timestamp within P90D is fresh", () => {
  const recent = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000)
    .toISOString();
  assertEquals(isStale(recent, "P90D", NOW), false);
});

Deno.test("isStale: timestamp older than P90D is stale", () => {
  const old = new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
  assertEquals(isStale(old, "P90D", NOW), true);
});

Deno.test("isStale: null timestamp is stale", () => {
  assertEquals(isStale(null, "P90D", NOW), true);
});

Deno.test("isStale: undefined timestamp is stale", () => {
  assertEquals(isStale(undefined, "P90D", NOW), true);
});

Deno.test("isStale: empty string timestamp is stale", () => {
  assertEquals(isStale("", "P90D", NOW), true);
});

Deno.test("isStale: invalid timestamp string is stale", () => {
  assertEquals(isStale("not-a-date", "P90D", NOW), true);
});

Deno.test("isStale: exactly at freshness boundary is fresh", () => {
  // Exactly 90 days ago — not strictly older than 90d
  const exactly = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000)
    .toISOString();
  assertEquals(isStale(exactly, "P90D", NOW), false);
});

// ---------------------------------------------------------------------------
// loadQuestions
// ---------------------------------------------------------------------------

async function withTempDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const VALID_QUESTION_YAML = `
question_id: q-test-001
claim_id: claim-test-001
evidence_id: evidence-test-001
descriptor: my-service
instance: service-descriptor-my-service-001
prompt: Is the recorded owner still accurate?
answer_type: yes_no
expected_answer: "yes"
freshness_window: P90D
`;

Deno.test("loadQuestions: parses a valid question file", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/q-test-001.yaml`, VALID_QUESTION_YAML);
    const questions = await loadQuestions(dir);
    assertEquals(questions.length, 1);
    assertEquals(questions[0].question_id, "q-test-001");
    assertEquals(questions[0].claim_id, "claim-test-001");
    assertEquals(questions[0].freshness_window, "P90D");
  });
});

Deno.test("loadQuestions: ignores non-yaml files", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/q-test-001.yaml`, VALID_QUESTION_YAML);
    await Deno.writeTextFile(`${dir}/README.md`, "# readme");
    await Deno.writeTextFile(`${dir}/notes.txt`, "notes");
    const questions = await loadQuestions(dir);
    assertEquals(questions.length, 1);
  });
});

Deno.test("loadQuestions: sorts by question_id", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/q-zzz.yaml`,
      VALID_QUESTION_YAML.replace("q-test-001", "q-zzz-001"),
    );
    await Deno.writeTextFile(
      `${dir}/q-aaa.yaml`,
      VALID_QUESTION_YAML.replace("q-test-001", "q-aaa-001"),
    );
    const questions = await loadQuestions(dir);
    assertEquals(questions[0].question_id, "q-aaa-001");
    assertEquals(questions[1].question_id, "q-zzz-001");
  });
});

Deno.test("loadQuestions: throws on missing required field", async () => {
  await withTempDir(async (dir) => {
    const broken = VALID_QUESTION_YAML.replace(
      "freshness_window: P90D",
      "",
    );
    await Deno.writeTextFile(`${dir}/q-broken.yaml`, broken);
    await assertRejects(
      () => loadQuestions(dir),
      Error,
      "freshness_window",
    );
  });
});

Deno.test("loadQuestions: returns empty array for empty dir", async () => {
  await withTempDir(async (dir) => {
    const questions = await loadQuestions(dir);
    assertEquals(questions.length, 0);
  });
});

// ---------------------------------------------------------------------------
// buildDeclarePayload
// ---------------------------------------------------------------------------

const DESCRIPTOR: DescriptorFile = {
  owner: {
    name: "Alice",
    team: "Platform",
    confirmedAt: "2026-06-01T00:00:00.000Z",
  },
  dependencies: [
    {
      name: "github-actions",
      type: "external-api",
      criticality: "critical",
      sla: "99.9%",
      fallbackPlan: "Manual attestation",
    },
  ],
  slos: [{ endpoint: "/health", target: 0.999, window: "30d" }],
};

Deno.test("buildDeclarePayload: injects attestedBy", () => {
  const payload = buildDeclarePayload(DESCRIPTOR, "alice@example.com");
  assertEquals(payload.attestedBy, "alice@example.com");
  assertEquals(payload.owner, DESCRIPTOR.owner);
  assertEquals(payload.dependencies, DESCRIPTOR.dependencies);
  assertEquals(payload.slos, DESCRIPTOR.slos);
});

Deno.test("buildDeclarePayload: does not include extra keys", () => {
  const payload = buildDeclarePayload(DESCRIPTOR, "alice@example.com");
  const keys = Object.keys(payload).sort();
  assertEquals(keys, ["attestedBy", "dependencies", "owner", "slos"]);
});

// ---------------------------------------------------------------------------
// getPendingQuestions
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    question_id: "q-test-001",
    claim_id: "claim-test-001",
    evidence_id: "evidence-test-001",
    descriptor: "my-service",
    instance: "service-descriptor-my-service-001",
    prompt: "Is the owner correct?",
    answer_type: "yes_no",
    expected_answer: "yes",
    freshness_window: "P90D",
    ...overrides,
  };
}

Deno.test("getPendingQuestions: fresh question is not pending", async () => {
  const q = makeQuestion();
  const recent = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000)
    .toISOString();
  const getter = (_instance: string) =>
    Promise.resolve(JSON.stringify({ content: { timestamp: recent } }));
  const pending = await getPendingQuestions([q], NOW, getter);
  assertEquals(pending.length, 0);
});

Deno.test("getPendingQuestions: stale question is pending", async () => {
  const q = makeQuestion();
  const old = new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
  const getter = (_instance: string) =>
    Promise.resolve(JSON.stringify({ content: { timestamp: old } }));
  const pending = await getPendingQuestions([q], NOW, getter);
  assertEquals(pending.length, 1);
  assertEquals(pending[0].question.question_id, "q-test-001");
});

Deno.test("getPendingQuestions: never-attested question is pending", async () => {
  const q = makeQuestion();
  const getter = (_instance: string): Promise<string | null> =>
    Promise.resolve(null);
  const pending = await getPendingQuestions([q], NOW, getter);
  assertEquals(pending.length, 1);
  assertEquals(pending[0].lastTimestamp, null);
});

Deno.test("getPendingQuestions: only stale questions among mixed freshness", async () => {
  const fresh = makeQuestion({
    question_id: "q-fresh",
    instance: "inst-fresh",
  });
  const stale = makeQuestion({
    question_id: "q-stale",
    instance: "inst-stale",
  });
  const recentTs = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000)
    .toISOString();
  const oldTs = new Date(NOW.getTime() - 100 * 24 * 60 * 60 * 1000)
    .toISOString();
  const getter = (instance: string): Promise<string | null> => {
    if (instance === "inst-fresh") {
      return Promise.resolve(
        JSON.stringify({ content: { timestamp: recentTs } }),
      );
    }
    return Promise.resolve(JSON.stringify({ content: { timestamp: oldTs } }));
  };
  const pending = await getPendingQuestions([fresh, stale], NOW, getter);
  assertEquals(pending.length, 1);
  assertEquals(pending[0].question.question_id, "q-stale");
});

Deno.test("getPendingQuestions: uses attributes fallback when content absent", async () => {
  const q = makeQuestion();
  const recent = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000)
    .toISOString();
  const getter = (_instance: string) =>
    Promise.resolve(JSON.stringify({ attributes: { timestamp: recent } }));
  const pending = await getPendingQuestions([q], NOW, getter);
  assertEquals(pending.length, 0);
});

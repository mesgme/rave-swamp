import { parse as parseYaml } from "jsr:@std/yaml@1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Question {
  question_id: string;
  claim_id: string;
  evidence_id: string;
  descriptor: string;
  instance: string;
  prompt: string;
  answer_type: "yes_no";
  expected_answer: string;
  freshness_window: string; // ISO 8601 duration e.g. P90D
}

export interface DescriptorFile {
  owner: {
    name: string;
    team: string;
    confirmedAt: string;
  };
  dependencies: Array<{
    name: string;
    type: string;
    criticality: string;
    sla?: string;
    fallbackPlan?: string;
  }>;
  slos: Array<{
    endpoint: string;
    target?: number;
    window?: string;
  }>;
}

export interface DeclarePayload {
  owner: {
    name: string;
    team: string;
    confirmedAt: string;
  };
  dependencies: DescriptorFile["dependencies"];
  slos: DescriptorFile["slos"];
  attestedBy: string;
}

export interface PendingQuestion {
  question: Question;
  lastTimestamp: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Parse an ISO 8601 duration string (P<n>D only) into milliseconds. */
export function parseDurationMs(duration: string): number {
  const match = duration.match(/^P(\d+)D$/);
  if (match) return parseInt(match[1], 10) * 24 * 60 * 60 * 1000;
  // Support P<n>M (months, approximate)
  const mMatch = duration.match(/^P(\d+)M$/);
  if (mMatch) return parseInt(mMatch[1], 10) * 30 * 24 * 60 * 60 * 1000;
  // Support P<n>Y
  const yMatch = duration.match(/^P(\d+)Y$/);
  if (yMatch) return parseInt(yMatch[1], 10) * 365 * 24 * 60 * 60 * 1000;
  throw new Error(`Unsupported ISO 8601 duration: ${duration}`);
}

/** Return true if the given timestamp is older than window from now, or if timestamp is absent. */
export function isStale(
  timestamp: string | null | undefined,
  window: string,
  now: Date,
): boolean {
  if (!timestamp) return true;
  const t = new Date(timestamp);
  if (isNaN(t.getTime())) return true;
  return now.getTime() - t.getTime() > parseDurationMs(window);
}

/** Load all question YAML files from a directory. */
export async function loadQuestions(dir: string): Promise<Question[]> {
  const questions: Question[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".yaml")) continue;
    const text = await Deno.readTextFile(`${dir}/${entry.name}`);
    const raw = parseYaml(text) as Question;
    const required: (keyof Question)[] = [
      "question_id",
      "claim_id",
      "evidence_id",
      "descriptor",
      "instance",
      "prompt",
      "answer_type",
      "expected_answer",
      "freshness_window",
    ];
    for (const field of required) {
      if (!raw[field]) {
        throw new Error(
          `Question file ${entry.name} is missing required field: ${field}`,
        );
      }
    }
    questions.push(raw);
  }
  questions.sort((a, b) => a.question_id.localeCompare(b.question_id));
  return questions;
}

/** Load a descriptor YAML file. */
export async function loadDescriptor(path: string): Promise<DescriptorFile> {
  const text = await Deno.readTextFile(path);
  return parseYaml(text) as DescriptorFile;
}

/** Build the declare method payload from a descriptor file + answerer. */
export function buildDeclarePayload(
  descriptor: DescriptorFile,
  attestedBy: string,
): DeclarePayload {
  return {
    owner: descriptor.owner,
    dependencies: descriptor.dependencies,
    slos: descriptor.slos,
    attestedBy,
  };
}

// ---------------------------------------------------------------------------
// Swamp shell-out (injectable for tests)
// ---------------------------------------------------------------------------

export type SwampDataGetter = (
  instance: string,
) => Promise<string | null>;

export type SwampMethodRunner = (
  instance: string,
  payload: DeclarePayload,
) => Promise<{ success: boolean; output: string }>;

export async function defaultSwampDataGetter(
  instance: string,
): Promise<string | null> {
  try {
    const cmd = new Deno.Command("swamp", {
      args: ["data", "get", instance, "current", "--json"],
      stdout: "piped",
      stderr: "piped",
    });
    const out = await cmd.output();
    if (!out.success) return null;
    return new TextDecoder().decode(out.stdout);
  } catch {
    return null;
  }
}

export async function defaultSwampMethodRunner(
  instance: string,
  payload: DeclarePayload,
): Promise<{ success: boolean; output: string }> {
  const json = JSON.stringify(payload);
  const cmd = new Deno.Command("swamp", {
    args: [
      "model",
      "method",
      "run",
      instance,
      "declare",
      "--stdin",
      "--json",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const process = cmd.spawn();
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(json));
  await writer.close();
  const out = await process.output();
  return {
    success: out.success,
    output: new TextDecoder().decode(out.stdout) +
      new TextDecoder().decode(out.stderr),
  };
}

// ---------------------------------------------------------------------------
// Core assessment logic
// ---------------------------------------------------------------------------

/** Read the timestamp from a swamp data get response. */
function extractTimestamp(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const attrs = parsed?.content ?? parsed?.attributes;
    return attrs?.timestamp ?? null;
  } catch {
    return null;
  }
}

/** Determine which questions are pending (stale or never attested). */
export async function getPendingQuestions(
  questions: Question[],
  now: Date,
  getSwampData: SwampDataGetter,
): Promise<PendingQuestion[]> {
  const pending: PendingQuestion[] = [];
  for (const q of questions) {
    const raw = await getSwampData(q.instance);
    const ts = extractTimestamp(raw);
    if (isStale(ts, q.freshness_window, now)) {
      pending.push({ question: q, lastTimestamp: ts });
    }
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = new Set(Deno.args);
  const repoDir = Deno.args.find((a) => !a.startsWith("-")) ?? ".";
  const jsonMode = args.has("--json");

  const attestedByArg = (() => {
    const idx = Deno.args.indexOf("--attested-by");
    if (idx !== -1 && Deno.args[idx + 1]) return Deno.args[idx + 1];
    return null;
  })();

  const questionsDir = `${repoDir}/rave/questions`;
  const descriptorsDir = `${repoDir}/rave/descriptors`;

  let questions: Question[];
  try {
    questions = await loadQuestions(questionsDir);
  } catch (err) {
    console.error(`Error loading questions from ${questionsDir}: ${err}`);
    Deno.exit(1);
  }

  if (questions.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ pending: [] }));
    } else {
      console.log("No questions found.");
    }
    return;
  }

  const now = new Date();
  const pending = await getPendingQuestions(
    questions,
    now,
    defaultSwampDataGetter,
  );

  if (jsonMode) {
    const out = pending.map((p) => ({
      question_id: p.question.question_id,
      prompt: p.question.prompt.trim(),
      claim_id: p.question.claim_id,
      instance: p.question.instance,
      lastTimestamp: p.lastTimestamp,
    }));
    console.log(JSON.stringify({ pending: out }, null, 2));
    return;
  }

  // Interactive mode — requires a TTY
  if (!Deno.stdin.isTerminal()) {
    console.error(
      "rave-assess: stdin is not a terminal. Use --json to list pending questions without prompting.",
    );
    Deno.exit(1);
  }

  if (pending.length === 0) {
    console.log("All attestation questions are up to date. Nothing to do.");
    return;
  }

  const attestedBy = attestedByArg ??
    Deno.env.get("USER") ??
    Deno.env.get("USERNAME") ??
    "unknown";

  let declared = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const { question, lastTimestamp } of pending) {
    const age = lastTimestamp
      ? `last attested ${new Date(lastTimestamp).toISOString().slice(0, 10)}`
      : "never attested";
    console.log(`\n[${question.question_id}] (${age})`);
    console.log(question.prompt.trim());
    const answer = prompt("Answer (yes/no): ")?.trim().toLowerCase();

    if (answer !== "yes") {
      console.log("  → Skipped.");
      skipped++;
      continue;
    }

    const descriptorPath = `${descriptorsDir}/${question.descriptor}.yaml`;
    let descriptor: DescriptorFile;
    try {
      descriptor = await loadDescriptor(descriptorPath);
    } catch (err) {
      console.error(
        `  → Error reading descriptor ${descriptorPath}: ${err}`,
      );
      errors.push(question.question_id);
      continue;
    }

    const payload = buildDeclarePayload(descriptor, attestedBy);
    console.log(`  → Declaring service descriptor for ${question.instance}…`);

    const result = await defaultSwampMethodRunner(question.instance, payload);
    if (!result.success) {
      console.error(`  → Declare failed:\n${result.output}`);
      errors.push(question.question_id);
    } else {
      // Extract attestedAt from the output if possible
      let attestedAt = "";
      try {
        const parsed = JSON.parse(result.output);
        const attrs = parsed?.content ?? parsed?.attributes ?? parsed;
        attestedAt = attrs?.attestedAt ?? attrs?.timestamp ?? "";
      } catch { /* ignore */ }
      console.log(
        `  → Declared. attestedAt: ${attestedAt || "(see swamp output)"}`,
      );
      declared++;
    }
  }

  console.log(
    `\nDone. Declared: ${declared}, Skipped: ${skipped}, Errors: ${errors.length}`,
  );
  if (errors.length > 0) {
    console.error(`Questions with errors: ${errors.join(", ")}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}

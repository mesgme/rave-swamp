import { z } from "npm:zod@4";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const GlobalArgsSchema = z.object({
  falsifierId: z.string(),
  conditionType: z.enum([
    "threshold",
    "boolean",
    "regex",
    "absence",
    "staleness",
    "composite",
  ]),
  condition: z.string(), // JSON-serialised condition parameters
});

const EvidenceInputSchema = z.object({
  evidenceId: z.string(),
  outcome: z.enum(["pass", "fail", "inconclusive"]),
  timestamp: z.string(),
  freshnessWindow: z.string().nullable(),
  value: z.number().nullable(),
  rawData: z.string().nullable(), // JSON string for field extraction
});

const EvaluationSchema = z.object({
  falsifierId: z.string(),
  // "unverified" means the condition could not be evaluated (for example, the
  // evidence carried no rawData for a field condition). It is never a pass.
  verdict: z.enum(["triggered", "not_triggered", "unverified"]),
  triggered: z.boolean(),
  evaluatedAt: z.string(),
  lastTriggeredAt: z.string().nullable(),
  conditionType: z.string(),
  detail: z.string(),
});

// ---------------------------------------------------------------------------
// ISO 8601 duration parser (seconds)
// ---------------------------------------------------------------------------

function parseISO8601Duration(duration: string): number {
  const re =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
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

// ---------------------------------------------------------------------------
// JSONPath extractor — supports:
//   $.field                   simple property
//   $.parent.child            nested property
//   $.array[*].field          array wildcard (returns array of values)
//   $.array[0].field          array index
// ---------------------------------------------------------------------------

export function extractJsonPath(data: unknown, path: string): unknown {
  if (!path.startsWith("$")) {
    throw new Error(`JSONPath must start with $: ${path}`);
  }

  // Tokenise: split on . but handle [*] and [n] array segments
  const parts = path
    .slice(1) // remove $
    .replace(/\[(\*|\d+)\]/g, ".$1") // [*] → .*  [0] → .0
    .split(".")
    .filter((p) => p.length > 0);

  function walk(node: unknown, segments: string[]): unknown {
    if (segments.length === 0) return node;
    const [head, ...rest] = segments;

    if (head === "*") {
      if (!Array.isArray(node)) return undefined;
      const results = node.map((item) => walk(item, rest));
      return results;
    }

    const index = Number(head);
    if (!isNaN(index) && Array.isArray(node)) {
      return walk((node as unknown[])[index], rest);
    }

    if (node !== null && typeof node === "object" && !Array.isArray(node)) {
      return walk((node as Record<string, unknown>)[head], rest);
    }

    return undefined;
  }

  return walk(data, parts);
}

// Flatten nested arrays returned by wildcard walks
function flatten(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [value];
  return value.flatMap(flatten);
}

// ---------------------------------------------------------------------------
// Condition evaluators
// ---------------------------------------------------------------------------

export type EvidenceItem = z.infer<typeof EvidenceInputSchema>;

export interface ConditionResult {
  triggered: boolean;
  unverified?: boolean;
  detail: string;
}

// Field conditions (threshold, boolean, regex) read rawData. Evidence without
// parseable rawData cannot be checked, so the condition is unverified rather
// than passed. A violation found in other evidence still triggers.
function parseRawData(ev: EvidenceItem): unknown | undefined {
  if (!ev.rawData) return undefined;
  try {
    return JSON.parse(ev.rawData);
  } catch {
    return undefined;
  }
}

function unreadable(evidence: EvidenceItem[]): string[] {
  return evidence
    .filter((ev) => parseRawData(ev) === undefined)
    .map((ev) => ev.evidenceId);
}

function unverifiedResult(ids: string[], what: string): ConditionResult {
  return {
    triggered: false,
    unverified: true,
    detail: `Cannot evaluate ${what}: no readable rawData in ${
      ids.join(", ")
    } (unverified)`,
  };
}

function evaluateThreshold(
  params: Record<string, unknown>,
  evidence: EvidenceItem[],
): ConditionResult {
  const metric = params.metric as string;
  const operator = params.operator as string;
  const threshold = params.threshold as number;

  for (const ev of evidence) {
    const parsed = parseRawData(ev);
    if (parsed === undefined) continue;
    const raw = extractJsonPath(parsed, metric);
    const values = flatten(raw);
    for (const v of values) {
      const num = typeof v === "number" ? v : parseFloat(String(v));
      if (isNaN(num)) continue;
      let hit = false;
      switch (operator) {
        case ">":
          hit = num > threshold;
          break;
        case ">=":
          hit = num >= threshold;
          break;
        case "<":
          hit = num < threshold;
          break;
        case "<=":
          hit = num <= threshold;
          break;
        case "==":
          hit = num === threshold;
          break;
        case "!=":
          hit = num !== threshold;
          break;
      }
      if (hit) {
        return {
          triggered: true,
          detail: `${metric} = ${num} ${operator} ${threshold} (triggered)`,
        };
      }
    }
  }
  const missingThreshold = unreadable(evidence);
  if (missingThreshold.length > 0 || evidence.length === 0) {
    return unverifiedResult(
      missingThreshold,
      `${metric} ${operator} ${threshold}`,
    );
  }
  return {
    triggered: false,
    detail:
      `No threshold violation found for ${metric} ${operator} ${threshold}`,
  };
}

function evaluateBoolean(
  params: Record<string, unknown>,
  evidence: EvidenceItem[],
): ConditionResult {
  const field = params.field as string;
  const expected = params.expected;

  for (const ev of evidence) {
    const parsed = parseRawData(ev);
    if (parsed === undefined) continue;
    const raw = extractJsonPath(parsed, field);
    const values = flatten(raw);
    for (const v of values) {
      // Triggered if value does NOT equal expected (presence/value violated)
      const equal = v === expected ||
        String(v) === String(expected) ||
        (expected === true && v !== null && v !== undefined && v !== false);
      if (!equal) {
        return {
          triggered: true,
          detail: `${field} = ${JSON.stringify(v)}, expected ${
            JSON.stringify(expected)
          } (triggered)`,
        };
      }
    }
    if (values.length === 0) {
      return {
        triggered: true,
        detail: `${field} not present in evidence (triggered)`,
      };
    }
  }
  const missingBoolean = unreadable(evidence);
  if (missingBoolean.length > 0 || evidence.length === 0) {
    return unverifiedResult(
      missingBoolean,
      `${field} == ${JSON.stringify(expected)}`,
    );
  }
  return {
    triggered: false,
    detail: `${field} matches expected value ${JSON.stringify(expected)}`,
  };
}

function evaluateRegex(
  params: Record<string, unknown>,
  evidence: EvidenceItem[],
): ConditionResult {
  const field = params.field as string;
  const pattern = params.pattern as string;
  const flags = (params.flags as string | undefined) ?? "";
  const re = new RegExp(pattern, flags);

  for (const ev of evidence) {
    const parsed = parseRawData(ev);
    if (parsed === undefined) continue;
    const raw = extractJsonPath(parsed, field);
    const values = flatten(raw);
    for (const v of values) {
      if (re.test(String(v))) {
        return {
          triggered: true,
          detail:
            `${field} value "${v}" matches /${pattern}/${flags} (triggered)`,
        };
      }
    }
  }
  const missingRegex = unreadable(evidence);
  if (missingRegex.length > 0 || evidence.length === 0) {
    return unverifiedResult(missingRegex, `${field} ~ /${pattern}/${flags}`);
  }
  return {
    triggered: false,
    detail: `No value of ${field} matches /${pattern}/${flags}`,
  };
}

function evaluateAbsence(
  params: Record<string, unknown>,
  evidence: EvidenceItem[],
): ConditionResult {
  if (evidence.length === 0) {
    return { triggered: true, detail: "No evidence present (triggered)" };
  }
  const gracePeriod = params.grace_period as string | undefined;
  if (!gracePeriod) {
    return {
      triggered: false,
      detail: `${evidence.length} evidence item(s) present`,
    };
  }
  const graceSeconds = parseISO8601Duration(gracePeriod);
  const now = Date.now();
  const mostRecent = Math.max(
    ...evidence.map((ev) => new Date(ev.timestamp).getTime()),
  );
  const ageSeconds = (now - mostRecent) / 1000;
  if (ageSeconds > graceSeconds) {
    return {
      triggered: true,
      detail: `Most recent evidence is ${
        Math.round(ageSeconds / 3600)
      }h old, exceeds grace period (triggered)`,
    };
  }
  return { triggered: false, detail: "Evidence present within grace period" };
}

function evaluateStaleness(
  params: Record<string, unknown>,
  evidence: EvidenceItem[],
): ConditionResult {
  const maxAge = params.max_age as string;
  const maxAgeSeconds = parseISO8601Duration(maxAge);
  const now = Date.now();

  if (evidence.length === 0) {
    return {
      triggered: true,
      detail: "No evidence to evaluate staleness (triggered)",
    };
  }

  const allStale = evidence.every((ev) => {
    const ageSeconds = (now - new Date(ev.timestamp).getTime()) / 1000;
    return ageSeconds > maxAgeSeconds;
  });

  return allStale
    ? {
      triggered: true,
      detail: `All evidence older than ${maxAge} (triggered)`,
    }
    : {
      triggered: false,
      detail: `Evidence within staleness window ${maxAge}`,
    };
}

function evaluateComposite(
  params: Record<string, unknown>,
  evidence: EvidenceItem[],
  depth: number,
): ConditionResult {
  if (depth > 5) {
    throw new Error("Composite condition recursion depth exceeded (max 5)");
  }

  const operator = (params.operator as string).toUpperCase();
  const subConditions = params.sub_conditions as Array<
    { type: string; parameters: Record<string, unknown> }
  >;

  const results = subConditions.map((sub) =>
    dispatchEvaluator(sub.type, sub.parameters, evidence, depth + 1)
  );

  const state = (r: ConditionResult) =>
    r.unverified ? "unverified" : r.triggered;
  const firstUnverified = results.find((r) => r.unverified);

  if (operator === "AND") {
    // One verified false sub-condition decides AND; otherwise an unverified one
    // leaves it undecided.
    const decidedFalse = results.some((r) => !r.unverified && !r.triggered);
    if (!decidedFalse && firstUnverified) {
      return {
        triggered: false,
        unverified: true,
        detail: `AND[${
          results.map(state).join(",")
        }] unverified: ${firstUnverified.detail}`,
      };
    }
    const triggered = !decidedFalse;
    return {
      triggered,
      detail: `AND[${results.map(state).join(",")}] = ${triggered}`,
    };
  }
  if (operator === "OR") {
    const firstHit = results.find((r) => r.triggered);
    if (firstHit) {
      return { triggered: true, detail: `OR triggered: ${firstHit.detail}` };
    }
    if (firstUnverified) {
      return {
        triggered: false,
        unverified: true,
        detail: `OR[${
          results.map(state).join(",")
        }] unverified: ${firstUnverified.detail}`,
      };
    }
    return {
      triggered: false,
      detail: `OR[${results.map(state).join(",")}] = false`,
    };
  }
  if (operator === "NOT") {
    if (results.length !== 1) {
      throw new Error("NOT operator requires exactly one sub-condition");
    }
    if (results[0].unverified) {
      return { ...results[0], detail: `NOT(unverified): ${results[0].detail}` };
    }
    return {
      triggered: !results[0].triggered,
      detail: `NOT(${results[0].triggered}) = ${!results[0].triggered}`,
    };
  }
  throw new Error(`Unknown composite operator: ${operator}`);
}

export function dispatchEvaluator(
  type: string,
  params: Record<string, unknown>,
  evidence: EvidenceItem[],
  depth: number,
): ConditionResult {
  switch (type) {
    case "threshold":
      return evaluateThreshold(params, evidence);
    case "boolean":
      return evaluateBoolean(params, evidence);
    case "regex":
      return evaluateRegex(params, evidence);
    case "absence":
      return evaluateAbsence(params, evidence);
    case "staleness":
      return evaluateStaleness(params, evidence);
    case "composite":
      return evaluateComposite(params, evidence, depth);
    default:
      throw new Error(`Unknown condition type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const model = {
  type: "@mellens/rave/falsifier-engine",
  version: "2026.11.23.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    evaluation: {
      description: "Latest falsifier evaluation result",
      schema: EvaluationSchema,
      lifetime: "30d",
      garbageCollection: 200,
    },
  },
  upgrades: [
    {
      fromVersion: "2026.03.21.1",
      toVersion: "2026.11.23.1",
      description:
        "No-op: evaluations gain a verdict field; unverifiable conditions fail the step",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  methods: {
    evaluate: {
      description:
        "Evaluate falsifier conditions against evidence snapshots and record triggered/not-triggered",
      arguments: z.object({
        evidence: z.array(EvidenceInputSchema),
      }),
      execute: async (args, context) => {
        const { falsifierId, conditionType, condition } = context.globalArgs;
        const evaluatedAt = new Date().toISOString();

        // Read previous evaluation to preserve lastTriggeredAt
        let lastTriggeredAt: string | null = null;
        try {
          const prev = await context.readResource("evaluation", "current");
          if ((prev as { triggered: boolean }).triggered) {
            lastTriggeredAt = (prev as { evaluatedAt: string }).evaluatedAt;
          } else {
            lastTriggeredAt =
              (prev as { lastTriggeredAt: string | null }).lastTriggeredAt;
          }
        } catch {
          // No previous record
        }

        let params: Record<string, unknown>;
        try {
          params = JSON.parse(condition);
        } catch {
          throw new Error(`Failed to parse condition JSON: ${condition}`);
        }

        const result = dispatchEvaluator(
          conditionType,
          params,
          args.evidence,
          0,
        );

        const verdict = result.unverified
          ? "unverified"
          : result.triggered
          ? "triggered"
          : "not_triggered";

        if (result.unverified) {
          context.logger.warn(
            `Falsifier '${falsifierId}' UNVERIFIED: ${result.detail}`,
          );
        } else if (result.triggered) {
          lastTriggeredAt = evaluatedAt;
          context.logger.warn(
            `Falsifier '${falsifierId}' TRIGGERED: ${result.detail}`,
          );
        } else {
          context.logger.info(
            `Falsifier '${falsifierId}' not triggered: ${result.detail}`,
          );
        }

        const handle = await context.writeResource("evaluation", "current", {
          falsifierId,
          verdict,
          triggered: result.triggered,
          evaluatedAt,
          lastTriggeredAt,
          conditionType,
          detail: result.detail,
        });

        // Record the unverified evaluation, then fail the step so the workflow
        // run cannot report success for a falsifier it could not check.
        if (result.unverified) {
          throw new Error(
            `Falsifier '${falsifierId}' could not be evaluated: ${result.detail}`,
          );
        }

        return { dataHandles: [handle] };
      },
    },
  },
};

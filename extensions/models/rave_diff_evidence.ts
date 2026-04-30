import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({
  evidenceId: z.string(),
  // Comma-delimited list of glob patterns, e.g. "rave/claims/**,rave/scopes/**"
  guardedGlobs: z.string(),
});

const ResultSchema = z.object({
  outcome: z.enum(["pass", "fail", "inconclusive"]),
  summary: z.string(),
  timestamp: z.string(),
  isStale: z.boolean(),
  failureReason: z.string().nullable(),
  remediation: z.string().nullable(),
  guardedChanged: z.array(z.string()),
  nonGuardedChanged: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Minimal glob matcher supporting * and ** wildcards.
// ---------------------------------------------------------------------------

function matchGlob(path: string, glob: string): boolean {
  const regexStr = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(.+/)?")
    .replace(/\*\*/g, ".+")
    .replace(/\*/g, "[^/]+");
  return new RegExp(`^${regexStr}$`).test(path);
}

function isGuarded(path: string, globs: string[]): boolean {
  return globs.some((g) => matchGlob(path, g));
}

// ---------------------------------------------------------------------------
// Pure classification — exported for unit testing.
// ---------------------------------------------------------------------------

export interface ClassifyResult {
  outcome: "pass" | "fail" | "inconclusive";
  guardedChanged: string[];
  nonGuardedChanged: string[];
  failureReason: string | null;
  remediation: string | null;
}

export function classifyPaths(
  paths: string[],
  guardedGlobs: string[],
): ClassifyResult {
  const guardedChanged: string[] = [];
  const nonGuardedChanged: string[] = [];

  for (const p of paths) {
    if (isGuarded(p, guardedGlobs)) {
      guardedChanged.push(p);
    } else {
      nonGuardedChanged.push(p);
    }
  }

  if (guardedChanged.length === 0) {
    return {
      outcome: "pass",
      guardedChanged,
      nonGuardedChanged,
      failureReason: null,
      remediation: null,
    };
  }

  if (nonGuardedChanged.length === 0) {
    return {
      outcome: "inconclusive",
      guardedChanged,
      nonGuardedChanged,
      failureReason: null,
      remediation: null,
    };
  }

  const failureReason = `PR mixes rave spec changes (${
    guardedChanged.join(", ")
  }) with application changes (${nonGuardedChanged.join(", ")})`;
  const remediation =
    "Split this PR: one PR for the rave spec changes (add the 'rave: spec-change' label), another for application code.";

  return {
    outcome: "fail",
    guardedChanged,
    nonGuardedChanged,
    failureReason,
    remediation,
  };
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const model = {
  type: "@mellens/rave/diff-evidence",
  version: "2026.04.29.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    result: {
      description: "Latest diff-based tamper evidence result",
      schema: ResultSchema,
      lifetime: "1d",
      garbageCollection: 48,
    },
  },
  methods: {
    gather: {
      description: "Run git diff to detect mixed spec+application PRs",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const { evidenceId } = context.globalArgs;
        const guardedGlobs = context.globalArgs.guardedGlobs
          .split(",")
          .map((g) => g.trim())
          .filter((g) => g.length > 0);
        const timestamp = new Date().toISOString();

        let diffOutput = "";
        try {
          const cmd = new Deno.Command("git", {
            args: ["diff", "origin/main...HEAD", "--name-only"],
            stdout: "piped",
            stderr: "piped",
          });
          const output = await cmd.output();
          diffOutput = new TextDecoder().decode(output.stdout);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          context.logger.warn(`${evidenceId}: git diff failed: ${message}`);
          const handle = await context.writeResource("result", "current", {
            outcome: "inconclusive",
            summary: `git diff failed: ${message}`,
            timestamp,
            isStale: false,
            failureReason: null,
            remediation: null,
            guardedChanged: [],
            nonGuardedChanged: [],
          });
          return { dataHandles: [handle] };
        }

        const paths = diffOutput.split("\n").map((l) => l.trim()).filter((l) =>
          l.length > 0
        );
        const classified = classifyPaths(paths, guardedGlobs);

        const summary = classified.outcome === "pass"
          ? `No guarded spec files changed (${paths.length} files total)`
          : classified.outcome === "inconclusive"
          ? `Only guarded spec files changed — pure spec PR (${classified.guardedChanged.length} files)`
          : classified.failureReason!;

        context.logger.info(
          `${evidenceId}: ${summary} → ${classified.outcome}`,
        );

        const handle = await context.writeResource("result", "current", {
          outcome: classified.outcome,
          summary,
          timestamp,
          isStale: false,
          failureReason: classified.failureReason,
          remediation: classified.remediation,
          guardedChanged: classified.guardedChanged,
          nonGuardedChanged: classified.nonGuardedChanged,
        });

        return { dataHandles: [handle] };
      },
    },
  },
};

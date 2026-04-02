import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({
  evidenceId: z.string(),
  repo: z.string(),
  workflowName: z.string(),
  branch: z.string().default("main"),
});

const ResultSchema = z.object({
  outcome: z.enum(["pass", "fail", "inconclusive"]),
  summary: z.string(),
  runId: z.string(),
  timestamp: z.string(),
  isStale: z.boolean(),
  rawStatus: z.string(),
});

function conclusionToOutcome(
  conclusion: string | null,
): "pass" | "fail" | "inconclusive" {
  if (conclusion === "success") return "pass";
  if (conclusion === "failure" || conclusion === "timed_out") return "fail";
  return "inconclusive";
}

export const model = {
  type: "@mellens/rave/ci-evidence",
  version: "2026.03.21.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    result: {
      description: "Latest CI run result for this evidence entity",
      schema: ResultSchema,
      lifetime: "30d",
      garbageCollection: 90,
    },
  },
  methods: {
    gather: {
      description:
        "Fetch the latest GitHub Actions workflow run and record the outcome",
      arguments: z.object({
        githubToken: z.string(),
      }),
      execute: async (args, context) => {
        const { repo, workflowName, branch } = context.globalArgs;
        const baseUrl = `https://api.github.com/repos/${repo}`;
        const headers = {
          "Authorization": `Bearer ${args.githubToken}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        };

        // Fetch latest run for the workflow on the given branch
        const runsUrl =
          `${baseUrl}/actions/workflows/${workflowName}/runs?branch=${branch}&per_page=1`;
        const runsRes = await fetch(runsUrl, { headers });

        if (runsRes.status === 404) {
          context.logger.warn(
            `Workflow '${workflowName}' not found in ${repo} — recording inconclusive`,
          );
          const handle = await context.writeResource("result", "latest", {
            outcome: "inconclusive",
            summary: `Workflow '${workflowName}' not found in ${repo}`,
            runId: "none",
            timestamp: new Date().toISOString(),
            isStale: false,
            rawStatus: "not_found",
          });
          return { dataHandles: [handle] };
        }

        if (runsRes.status === 429) {
          throw new Error(
            "GitHub API rate limit exceeded — retry after cooldown",
          );
        }

        if (!runsRes.ok) {
          throw new Error(
            `GitHub API error ${runsRes.status}: ${await runsRes.text()}`,
          );
        }

        const runsData = await runsRes.json();
        const runs = runsData.workflow_runs ?? [];

        if (runs.length === 0) {
          context.logger.warn(
            `No runs found for workflow '${workflowName}' on branch '${branch}'`,
          );
          const handle = await context.writeResource("result", "latest", {
            outcome: "inconclusive",
            summary:
              `No runs found for '${workflowName}' on branch '${branch}'`,
            runId: "none",
            timestamp: new Date().toISOString(),
            isStale: false,
            rawStatus: "no_runs",
          });
          return { dataHandles: [handle] };
        }

        const run = runs[0];
        const outcome = conclusionToOutcome(run.conclusion);
        const summary = buildSummary(run);

        context.logger.info(
          `Run #${run.id}: status=${run.status} conclusion=${run.conclusion} → ${outcome}`,
        );

        const handle = await context.writeResource("result", "latest", {
          outcome,
          summary,
          runId: String(run.id),
          timestamp: run.created_at,
          isStale: false,
          rawStatus: run.conclusion ?? run.status ?? "unknown",
        });

        return { dataHandles: [handle] };
      },
    },
  },
};

function buildSummary(run: Record<string, unknown>): string {
  const name = run.name ?? run.display_title ?? "workflow";
  const conclusion = run.conclusion ?? run.status ?? "unknown";
  const branch = run.head_branch ?? "unknown";
  const sha = typeof run.head_sha === "string"
    ? run.head_sha.slice(0, 7)
    : "unknown";
  return `${name} on ${branch}@${sha}: ${conclusion}`;
}

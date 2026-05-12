import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({
  evidenceId: z.string(),
  repo: z.string(),
  workflowName: z.string(),
  branch: z.string().default("main"),
  jobName: z.string().optional(),
});

const ResultSchema = z.object({
  outcome: z.enum(["pass", "fail", "inconclusive"]),
  summary: z.string(),
  runId: z.string(),
  timestamp: z.string(),
  isStale: z.boolean(),
  rawStatus: z.string(),
  failureReason: z.string().nullable(),
  remediation: z.string().nullable(),
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
  version: "2026.05.01.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    result: {
      description: "Latest CI run result for this evidence entity",
      schema: ResultSchema,
      lifetime: "30d",
      garbageCollection: 90,
    },
  },
  upgrades: [
    {
      fromVersion: "2026.03.21.1",
      toVersion: "2026.04.30.1",
      description: "No-op: adds failureReason and remediation to result schema",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      fromVersion: "2026.04.30.1",
      toVersion: "2026.05.01.1",
      description:
        "No-op: adds optional jobName global argument for per-job CI evidence",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  methods: {
    gather: {
      description:
        "Fetch the latest GitHub Actions workflow run (or specific job) and record the outcome",
      arguments: z.object({
        githubToken: z.string(),
      }),
      execute: async (args, context) => {
        const { repo, workflowName, branch, jobName } = context.globalArgs;
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
          const handle = await context.writeResource("result", "current", {
            outcome: "inconclusive",
            summary: `Workflow '${workflowName}' not found in ${repo}`,
            runId: "none",
            timestamp: new Date().toISOString(),
            isStale: false,
            rawStatus: "not_found",
            failureReason: null,
            remediation: null,
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
          const handle = await context.writeResource("result", "current", {
            outcome: "inconclusive",
            summary:
              `No runs found for '${workflowName}' on branch '${branch}'`,
            runId: "none",
            timestamp: new Date().toISOString(),
            isStale: false,
            rawStatus: "no_runs",
            failureReason: null,
            remediation: null,
          });
          return { dataHandles: [handle] };
        }

        const run = runs[0];

        // Without jobName: use workflow-level conclusion (original behaviour)
        if (!jobName) {
          const outcome = conclusionToOutcome(run.conclusion);
          const summary = buildWorkflowSummary(run);

          context.logger.info(
            `Run #${run.id}: status=${run.status} conclusion=${run.conclusion} → ${outcome}`,
          );

          const handle = await context.writeResource("result", "current", {
            outcome,
            summary,
            runId: String(run.id),
            timestamp: run.created_at,
            isStale: false,
            rawStatus: run.conclusion ?? run.status ?? "unknown",
            failureReason: outcome === "fail" ? summary : null,
            remediation: outcome === "fail"
              ? `Check the Actions log for run #${run.id} at https://github.com/${repo}/actions/runs/${run.id}`
              : null,
          });

          return { dataHandles: [handle] };
        }

        // With jobName: fetch per-job conclusions for this run
        return await gatherJobOutcome(
          baseUrl,
          headers,
          run,
          jobName,
          repo,
          context,
        );
      },
    },
  },
};

async function gatherJobOutcome(
  baseUrl: string,
  headers: Record<string, string>,
  run: Record<string, unknown>,
  jobName: string,
  repo: string,
  context: {
    logger: { info: (s: string) => void; warn: (s: string) => void };
    writeResource: (
      spec: string,
      name: string,
      data: unknown,
    ) => Promise<unknown>;
  },
) {
  const runId = run.id;
  const branch = run.head_branch ?? "unknown";
  const sha = typeof run.head_sha === "string"
    ? run.head_sha.slice(0, 7)
    : "unknown";

  let job: Record<string, unknown> | null = null;
  let page = 1;

  while (!job) {
    const jobsUrl =
      `${baseUrl}/actions/runs/${runId}/jobs?per_page=100&page=${page}`;
    const jobsRes = await fetch(jobsUrl, { headers });

    if (!jobsRes.ok) {
      throw new Error(
        `GitHub API error ${jobsRes.status} fetching jobs for run ${runId}: ${await jobsRes
          .text()}`,
      );
    }

    const jobsData = await jobsRes.json();
    const jobs: Record<string, unknown>[] = jobsData.jobs ?? [];

    const found = jobs.find((j) => j.name === jobName);
    if (found) {
      job = found;
      break;
    }

    // No more pages
    if (jobs.length < 100) break;
    page++;
  }

  if (!job) {
    context.logger.warn(
      `Job '${jobName}' not found in run #${runId} of '${run.name}' — recording inconclusive`,
    );
    const handle = await context.writeResource("result", "current", {
      outcome: "inconclusive",
      summary:
        `Job '${jobName}' not found in run #${runId} on ${branch}@${sha}`,
      runId: String(runId),
      timestamp: run.created_at ?? new Date().toISOString(),
      isStale: false,
      rawStatus: "job_not_found",
      failureReason: null,
      remediation: null,
    });
    return { dataHandles: [handle] };
  }

  const conclusion = job.conclusion as string | null;
  const outcome = conclusionToOutcome(conclusion);

  context.logger.info(
    `Run #${runId} job '${jobName}': conclusion=${conclusion} → ${outcome}`,
  );

  const jobSummary = `${jobName} on ${branch}@${sha}: ${
    conclusion ?? job.status ?? "unknown"
  }`;
  const handle = await context.writeResource("result", "current", {
    outcome,
    summary: jobSummary,
    runId: String(runId),
    timestamp: (job.completed_at ?? run.created_at) as string,
    isStale: false,
    rawStatus: conclusion ?? (job.status as string) ?? "unknown",
    failureReason: outcome === "fail" ? jobSummary : null,
    remediation: outcome === "fail"
      ? `Check the '${jobName}' job log at https://github.com/${repo}/actions/runs/${runId}`
      : null,
  });

  return { dataHandles: [handle] };
}

function buildWorkflowSummary(run: Record<string, unknown>): string {
  const name = run.name ?? run.display_title ?? "workflow";
  const conclusion = run.conclusion ?? run.status ?? "unknown";
  const branch = run.head_branch ?? "unknown";
  const sha = typeof run.head_sha === "string"
    ? run.head_sha.slice(0, 7)
    : "unknown";
  return `${name} on ${branch}@${sha}: ${conclusion}`;
}

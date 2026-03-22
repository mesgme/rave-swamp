import { z } from "npm:zod@4";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const GlobalArgsSchema = z.object({
  evidenceId: z.string(),
  repo: z.string(),          // e.g. "mesgme/rave-swamp"
  endpoint: z.string(),      // path after /repos/{repo}, e.g. "/branches/main/protection"
  successField: z.string().optional(), // JSONPath to check for truthy value → pass
});

const ResultSchema = z.object({
  outcome: z.enum(["pass", "fail", "inconclusive"]),
  summary: z.string(),
  rawData: z.string(),     // JSON-stringified API response (used by falsifier-engine)
  timestamp: z.string(),
  isStale: z.boolean(),
  httpStatus: z.number(),
});

// ---------------------------------------------------------------------------
// Minimal JSONPath extractor (dot-paths and [*] wildcards)
// Shared logic with falsifier-engine — duplicated to keep models self-contained.
// ---------------------------------------------------------------------------

function extractJsonPath(data: unknown, path: string): unknown {
  if (!path.startsWith("$")) throw new Error(`JSONPath must start with $: ${path}`);

  const parts = path
    .slice(1)
    .replace(/\[(\*|\d+)\]/g, ".$1")
    .split(".")
    .filter((p) => p.length > 0);

  function walk(node: unknown, segments: string[]): unknown {
    if (segments.length === 0) return node;
    const [head, ...rest] = segments;
    if (head === "*") {
      if (!Array.isArray(node)) return undefined;
      return node.map((item) => walk(item, rest));
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

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const model = {
  type: "rave/github-api-evidence",
  version: "2026.03.22.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    result: {
      description: "Latest GitHub REST API evidence result",
      schema: ResultSchema,
      lifetime: "1d",
      garbageCollection: 48,
    },
  },
  methods: {
    gather: {
      description: "Call a GitHub REST API endpoint and record the outcome",
      arguments: z.object({
        githubToken: z.string(),
      }),
      execute: async (args, context) => {
        const { repo, endpoint, evidenceId, successField } = context.globalArgs;
        const timestamp = new Date().toISOString();
        const url = `https://api.github.com/repos/${repo}${endpoint}`;

        const headers = {
          "Authorization": `Bearer ${args.githubToken}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        };

        let res: Response;
        try {
          res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          context.logger.warn(`GitHub API request failed: ${message} — recording inconclusive`);
          const handle = await context.writeResource("result", "latest", {
            outcome: "inconclusive",
            summary: `Request failed: ${message}`,
            rawData: "{}",
            timestamp,
            isStale: false,
            httpStatus: 0,
          });
          return { dataHandles: [handle] };
        }

        const httpStatus = res.status;
        const bodyText = await res.text();

        if (httpStatus === 404) {
          context.logger.warn(`${evidenceId}: endpoint returned 404 — recording inconclusive`);
          const handle = await context.writeResource("result", "latest", {
            outcome: "inconclusive",
            summary: `Endpoint not found: ${endpoint}`,
            rawData: bodyText,
            timestamp,
            isStale: false,
            httpStatus,
          });
          return { dataHandles: [handle] };
        }

        if (httpStatus === 429) {
          throw new Error("GitHub API rate limit exceeded — retry after cooldown");
        }

        if (!res.ok) {
          throw new Error(`GitHub API error ${httpStatus}: ${bodyText}`);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(bodyText);
        } catch {
          throw new Error(`Failed to parse GitHub API response as JSON`);
        }

        const rawData = bodyText;

        // Evaluate successField if provided
        let outcome: "pass" | "fail" | "inconclusive";
        let summary: string;

        if (successField) {
          const value = extractJsonPath(parsed, successField);
          const passing = isTruthy(value);
          outcome = passing ? "pass" : "fail";
          summary = `${endpoint}: ${successField} = ${JSON.stringify(value)} → ${outcome}`;
          context.logger.info(`${evidenceId}: ${successField} = ${JSON.stringify(value)} → ${outcome}`);
        } else {
          outcome = "pass";
          summary = `${endpoint}: HTTP ${httpStatus} → pass`;
          context.logger.info(`${evidenceId}: HTTP ${httpStatus} → pass`);
        }

        const handle = await context.writeResource("result", "latest", {
          outcome,
          summary,
          rawData,
          timestamp,
          isStale: false,
          httpStatus,
        });

        return { dataHandles: [handle] };
      },
    },
  },
};

import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({
  evidenceId: z.string(),
  baseUrl: z.string(),
  query: z.string(),
  threshold: z.number().optional(),
  operator: z.enum([">", ">=", "<", "<=", "==", "!="]).optional(),
  unit: z.string().optional(),
});

const ResultSchema = z.object({
  outcome: z.enum(["pass", "fail", "inconclusive"]),
  summary: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  timestamp: z.string(),
  isStale: z.boolean(),
  queryExecutedAt: z.string(),
});

function extractValue(data: Record<string, unknown>): number | null {
  const resultType = data.resultType as string;
  const result = data.result;

  if (resultType === "scalar" && Array.isArray(result) && result.length === 2) {
    const v = parseFloat(result[1] as string);
    return isNaN(v) ? null : v;
  }

  if (resultType === "vector" && Array.isArray(result) && result.length > 0) {
    const first = result[0] as Record<string, unknown>;
    const valueArr = first.value as [unknown, string];
    if (Array.isArray(valueArr) && valueArr.length === 2) {
      const v = parseFloat(valueArr[1]);
      return isNaN(v) ? null : v;
    }
  }

  return null;
}

function evaluateThreshold(
  value: number,
  operator: string,
  threshold: number,
): boolean {
  switch (operator) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
    case "!=":
      return value !== threshold;
    default:
      return false;
  }
}

function buildSummary(
  query: string,
  value: number | null,
  unit: string | null,
  outcome: string,
  operator?: string,
  threshold?: number,
): string {
  const shortQuery = query.length > 60 ? query.slice(0, 57) + "..." : query;
  if (value === null) return `${shortQuery}: no data (${outcome})`;
  const valueStr = unit ? `${value} ${unit}` : String(value);
  if (operator !== undefined && threshold !== undefined) {
    return `${shortQuery}: ${valueStr} (${operator} ${threshold} → ${outcome})`;
  }
  return `${shortQuery}: ${valueStr} (${outcome})`;
}

export const model = {
  type: "@mellens/rave/prometheus-evidence",
  version: "2026.03.21.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    result: {
      description: "Latest Prometheus query result",
      schema: ResultSchema,
      lifetime: "7d",
      garbageCollection: 168,
    },
  },
  methods: {
    gather: {
      description:
        "Execute a PromQL instant query and record the outcome against an optional threshold",
      arguments: z.object({
        prometheusToken: z.string(),
      }),
      execute: async (args, context) => {
        const { baseUrl, query, threshold, operator, unit } =
          context.globalArgs;
        const queryExecutedAt = new Date().toISOString();
        const encodedQuery = encodeURIComponent(query);
        const url = `${baseUrl}/api/v1/query?query=${encodedQuery}`;

        const headers: Record<string, string> = {
          "Accept": "application/json",
        };
        if (args.prometheusToken) {
          headers["Authorization"] = `Bearer ${args.prometheusToken}`;
        }

        let res: Response;
        try {
          res = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(15_000),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          context.logger.warn(
            `Prometheus request failed: ${message} — recording inconclusive`,
          );
          const handle = await context.writeResource("result", "latest", {
            outcome: "inconclusive",
            summary: `Query failed: ${message}`,
            value: null,
            unit: unit ?? null,
            timestamp: queryExecutedAt,
            isStale: false,
            queryExecutedAt,
          });
          return { dataHandles: [handle] };
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Prometheus API error ${res.status}: ${body}`);
        }

        const payload = await res.json() as {
          status: string;
          data: Record<string, unknown>;
        };

        if (payload.status !== "success") {
          throw new Error(`Prometheus returned status '${payload.status}'`);
        }

        const value = extractValue(payload.data);

        if (value === null) {
          context.logger.warn(`No data returned for query: ${query}`);
          const handle = await context.writeResource("result", "latest", {
            outcome: "inconclusive",
            summary: buildSummary(query, null, unit ?? null, "inconclusive"),
            value: null,
            unit: unit ?? null,
            timestamp: queryExecutedAt,
            isStale: false,
            queryExecutedAt,
          });
          return { dataHandles: [handle] };
        }

        let outcome: "pass" | "fail" | "inconclusive";
        if (threshold !== undefined && operator !== undefined) {
          outcome = evaluateThreshold(value, operator, threshold)
            ? "fail"
            : "pass";
        } else {
          outcome = "pass";
        }

        context.logger.info(
          `Query value=${value}${unit ? " " + unit : ""} → ${outcome}`,
        );

        const handle = await context.writeResource("result", "latest", {
          outcome,
          summary: buildSummary(
            query,
            value,
            unit ?? null,
            outcome,
            operator,
            threshold,
          ),
          value,
          unit: unit ?? null,
          timestamp: queryExecutedAt,
          isStale: false,
          queryExecutedAt,
        });

        return { dataHandles: [handle] };
      },
    },
  },
};

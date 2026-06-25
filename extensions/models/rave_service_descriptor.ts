import { z } from "npm:zod@4";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const OwnerSchema = z.object({
  name: z.string(),
  team: z.string(),
  confirmedAt: z.string(), // ISO8601
});

const DependencySchema = z.object({
  name: z.string(),
  type: z.enum(["service", "database", "queue", "external-api", "library"]),
  criticality: z.enum(["critical", "standard"]),
  sla: z.string().optional(), // documented SLA; required for critical deps
  fallbackPlan: z.string().optional(), // fallback when this dep is down; required for critical deps
});

// Optional target/window to allow incomplete declarations (sloComplete derivation checks for them).
const SloSchema = z.object({
  endpoint: z.string(),
  target: z.number().optional(), // e.g. 0.999
  window: z.string().optional(), // e.g. "30d"
});

const GlobalArgsSchema = z.object({
  serviceId: z.string(),
  repo: z.string(), // e.g. "mesgme/rave-swamp"
});

const ResultSchema = z.object({
  serviceId: z.string(),
  owner: OwnerSchema,
  dependencies: z.array(DependencySchema),
  slos: z.array(SloSchema),
  attestedBy: z.string(),
  attestedAt: z.string(), // ISO8601 — time of this attestation; used as timestamp for staleness

  // Derived fields (computed by declare; readable via JSONPath on rawData)
  criticalDepsDocumented: z.boolean(), // true when no critical dep is missing sla or fallbackPlan
  undocumentedCriticalDeps: z.array(z.string()),
  sloComplete: z.boolean(), // true when every SLO entry has both target and window
  incompleteEndpoints: z.array(z.string()),

  // Standard evidence fields (match rave_ci_evidence / rave_github_api_evidence conventions)
  outcome: z.enum(["pass", "fail", "inconclusive"]),
  summary: z.string(),
  timestamp: z.string(), // = attestedAt; staleness falsifier (max_age: P90D) reads this
  isStale: z.boolean(), // false at write time; confidence engine applies decay separately
  rawData: z.string(), // JSON.stringify of derived payload; falsifiers JSONPath $.criticalDepsDocumented / $.sloComplete
  failureReason: z.string().nullable(), // non-null only on "fail"
  remediation: z.string().nullable(), // non-null only on "fail"
});

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const model = {
  type: "@mellens/rave/service-descriptor",
  version: "2026.06.24.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    descriptor: {
      description:
        "Current service descriptor — ownership, dependencies, and SLOs; multiple claims read derived fields via falsifier JSONPath",
      schema: ResultSchema,
      lifetime: "180d",
      garbageCollection: 90,
    },
  },
  methods: {
    declare: {
      description:
        "Record a human-attested service descriptor (owner, deps, SLOs); compute criticalDepsDocumented and sloComplete",
      arguments: z.object({
        owner: OwnerSchema,
        dependencies: z.array(DependencySchema),
        slos: z.array(SloSchema),
        attestedBy: z.string(),
      }),
      execute: async (args, context) => {
        const { serviceId } = context.globalArgs;
        const { owner, dependencies, slos, attestedBy } = args;
        const attestedAt = new Date().toISOString();

        // --- Derive critical-dep completeness ---
        // A critical dep must have both sla and fallbackPlan documented.
        const undocumentedCriticalDeps = dependencies
          .filter((d) =>
            d.criticality === "critical" && (!d.sla || !d.fallbackPlan)
          )
          .map((d) => d.name);
        const criticalDepsDocumented = undocumentedCriticalDeps.length === 0;

        // --- Derive SLO completeness ---
        // Every SLO entry must declare both a numeric target and a measurement window.
        const incompleteEndpoints = slos
          .filter((s) => s.target === undefined || s.window === undefined)
          .map((s) => s.endpoint);
        const sloComplete = incompleteEndpoints.length === 0;

        // --- Outcome ---
        const outcome: "pass" | "fail" = criticalDepsDocumented && sloComplete
          ? "pass"
          : "fail";

        const failureReasons: string[] = [];
        if (!criticalDepsDocumented) {
          failureReasons.push(
            `undocumented critical deps: ${
              undocumentedCriticalDeps.join(", ")
            }`,
          );
        }
        if (!sloComplete) {
          failureReasons.push(
            `incomplete SLO entries: ${incompleteEndpoints.join(", ")}`,
          );
        }

        const summary = outcome === "pass"
          ? `Service descriptor for ${serviceId}: all checks pass`
          : `Service descriptor for ${serviceId}: ${failureReasons.join("; ")}`;

        const failureReason = outcome === "fail" ? summary : null;
        const remediation = outcome === "fail"
          ? `Re-run 'rave_service_descriptor declare' with complete data: ` +
            `critical deps need sla + fallbackPlan; every SLO endpoint needs target + window`
          : null;

        // rawData: JSON-serialised payload readable by falsifier-engine JSONPath.
        // Includes derived booleans so falsifiers can evaluate $.criticalDepsDocumented and $.sloComplete.
        const rawData = JSON.stringify({
          serviceId,
          criticalDepsDocumented,
          undocumentedCriticalDeps,
          sloComplete,
          incompleteEndpoints,
          outcome,
          attestedBy,
          attestedAt,
        });

        context.logger.info(
          `${serviceId}: outcome=${outcome}, criticalDepsDocumented=${criticalDepsDocumented}, sloComplete=${sloComplete}`,
        );

        const handle = await context.writeResource("descriptor", "current", {
          serviceId,
          owner,
          dependencies,
          slos,
          attestedBy,
          attestedAt,
          criticalDepsDocumented,
          undocumentedCriticalDeps,
          sloComplete,
          incompleteEndpoints,
          outcome,
          summary,
          timestamp: attestedAt, // staleness falsifier reads this
          isStale: false,
          rawData,
          failureReason,
          remediation,
        });

        return { dataHandles: [handle] };
      },
    },
  },
};

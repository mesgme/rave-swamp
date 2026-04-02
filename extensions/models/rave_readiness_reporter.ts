import { z } from "npm:zod@4";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const EvaluateArgsSchema = z.object({
  threshold: z.coerce.number().min(0).max(1).default(0.7),
  // Per-claim inputs — flat args because CEL cannot construct arrays in workflow inputs
  branchProtectionId: z.string(),
  branchProtectionStatus: z.string(),
  branchProtectionScore: z.coerce.number(),
  ciGreenId: z.string(),
  ciGreenStatus: z.string(),
  ciGreenScore: z.coerce.number(),
  swampModelsId: z.string(),
  swampModelsStatus: z.string(),
  swampModelsScore: z.coerce.number(),
  swampWorkflowsId: z.string(),
  swampWorkflowsStatus: z.string(),
  swampWorkflowsScore: z.coerce.number(),
  extensionsCompileId: z.string(),
  extensionsCompileStatus: z.string(),
  extensionsCompileScore: z.coerce.number(),
});

const ClaimReadinessSchema = z.object({
  claimId: z.string(),
  status: z.string(),
  confidenceScore: z.number(),
  meetsThreshold: z.boolean(),
  reason: z.string().nullable(),
});

const ReportSchema = z.object({
  threshold: z.number(),
  ready: z.boolean(),
  evaluatedAt: z.string(),
  claims: z.array(ClaimReadinessSchema),
  summary: z.string(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function evaluateClaim(
  claimId: string,
  status: string,
  confidenceScore: number,
  threshold: number,
): z.infer<typeof ClaimReadinessSchema> {
  if (status === "draft" || status === "retired") {
    return {
      claimId,
      status,
      confidenceScore,
      meetsThreshold: true,
      reason: `${status} — excluded from readiness gate`,
    };
  }
  if (status === "contradicted") {
    return {
      claimId,
      status,
      confidenceScore,
      meetsThreshold: false,
      reason: "contradicted — fails readiness gate",
    };
  }
  const meetsThreshold = confidenceScore >= threshold;
  return {
    claimId,
    status,
    confidenceScore,
    meetsThreshold,
    reason: meetsThreshold
      ? null
      : `score ${confidenceScore.toFixed(3)} below threshold ${threshold}`,
  };
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const model = {
  type: "@mellens/rave/readiness-reporter",
  version: "2026.03.23.1",
  resources: {
    report: {
      description: "Latest readiness evaluation report",
      schema: ReportSchema,
      lifetime: "7d",
      garbageCollection: 50,
    },
  },
  methods: {
    evaluate: {
      description:
        "Evaluate readiness across all active claims by comparing confidence scores to threshold. Draft and retired claims are excluded; contradicted claims always fail.",
      arguments: EvaluateArgsSchema,
      execute: async (args, context) => {
        const evaluatedAt = new Date().toISOString();
        const threshold = args.threshold;

        const claims = [
          evaluateClaim(
            args.branchProtectionId,
            args.branchProtectionStatus,
            args.branchProtectionScore,
            threshold,
          ),
          evaluateClaim(
            args.ciGreenId,
            args.ciGreenStatus,
            args.ciGreenScore,
            threshold,
          ),
          evaluateClaim(
            args.swampModelsId,
            args.swampModelsStatus,
            args.swampModelsScore,
            threshold,
          ),
          evaluateClaim(
            args.swampWorkflowsId,
            args.swampWorkflowsStatus,
            args.swampWorkflowsScore,
            threshold,
          ),
          evaluateClaim(
            args.extensionsCompileId,
            args.extensionsCompileStatus,
            args.extensionsCompileScore,
            threshold,
          ),
        ];

        const gateClaims = claims.filter(
          (c) => c.status !== "draft" && c.status !== "retired",
        );
        const ready = gateClaims.length > 0
          ? gateClaims.every((c) => c.meetsThreshold)
          : true;

        const passing = gateClaims.filter((c) => c.meetsThreshold).length;
        const excluded = claims.length - gateClaims.length;
        const summary = [
          `${passing} of ${gateClaims.length} active claims meet threshold (${threshold}).`,
          excluded > 0 ? `${excluded} claim(s) excluded (draft/retired).` : "",
        ]
          .filter(Boolean)
          .join(" ");

        if (ready) {
          context.logger.info(`Readiness: READY — ${summary}`);
        } else {
          context.logger.warn(`Readiness: NOT READY — ${summary}`);
          for (const c of gateClaims.filter((x) => !x.meetsThreshold)) {
            context.logger.warn(`  ✗ ${c.claimId}: ${c.reason}`);
          }
        }

        const handle = await context.writeResource("report", "latest", {
          threshold,
          ready,
          evaluatedAt,
          claims,
          summary,
        });

        return { dataHandles: [handle] };
      },
    },
  },
};

import { z } from "npm:zod@4";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const GlobalArgsSchema = z.object({
  claimId: z.string(),
  decayLambda: z.coerce.number().default(0.05),
  confidenceFloor: z.coerce.number().default(0.01),
});

const EvidenceSnapshotSchema = z.object({
  evidenceId: z.string(),
  outcome: z.string(),
  isStale: z.boolean(),
  qualityScore: z.number(),
  freshnessContribution: z.number(),
});

const ConfidenceSchema = z.object({
  claimId: z.string(),
  confidenceScore: z.number(),
  previousScore: z.number().nullable(),
  fAvg: z.number(),
  qAvg: z.number(),
  decayFactor: z.number(),
  lastValidated: z.string(),
  computedAt: z.string(),
  evidenceSnapshots: z.array(EvidenceSnapshotSchema),
  statusTransition: z.string().nullable(),
});

const EvidenceInputSchema = z.object({
  evidenceId: z.string(),
  outcome: z.enum(["pass", "fail", "inconclusive"]),
  timestamp: z.string(),
  freshnessWindow: z.string().nullable(),
  qualityScore: z.number().nullable(),
});

// ---------------------------------------------------------------------------
// ISO 8601 duration parser
// Supported: P<n>D, PT<n>H, PT<n>M, P<n>W, and combinations like P1DT12H
// Returns duration in seconds.
// ---------------------------------------------------------------------------

function parseISO8601Duration(duration: string): number {
  // Matches: P[nY][nM][nW][nD][T[nH][nM][nS]]
  const re = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
  const m = duration.match(re);
  if (!m) throw new Error(`Invalid ISO 8601 duration: ${duration}`);

  const years = parseFloat(m[1] ?? "0");
  const months = parseFloat(m[2] ?? "0");
  const weeks = parseFloat(m[3] ?? "0");
  const days = parseFloat(m[4] ?? "0");
  const hours = parseFloat(m[5] ?? "0");
  const minutes = parseFloat(m[6] ?? "0");
  const seconds = parseFloat(m[7] ?? "0");

  return (
    years * 365 * 86400 +
    months * 30 * 86400 +
    weeks * 7 * 86400 +
    days * 86400 +
    hours * 3600 +
    minutes * 60 +
    seconds
  );
}

function isStaleCheck(timestamp: string, freshnessWindow: string | null): boolean {
  if (!freshnessWindow) return false;
  const ageSeconds = (Date.now() - new Date(timestamp).getTime()) / 1000;
  const windowSeconds = parseISO8601Duration(freshnessWindow);
  return ageSeconds >= windowSeconds;
}

// ---------------------------------------------------------------------------
// Formula: C(t) = C₀ × F_avg × Q_avg × e^(−λ × Δt)
//
// Verified against spec section 6.4.7 worked examples:
//   Day 0:  C₀=0.85, Δt=0, F_avg=1.0, Q_avg=0.9, λ=0.05 → 0.77
//   Day 3:  C₀=0.77, Δt=0, F_avg=1.0, Q_avg=0.9, λ=0.05 → 0.69
//   Day 10: C₀=0.69, Δt=7, F_avg=1.0, Q_avg=0.9, λ=0.05 → 0.44
//   Day 12: C₀=0.44, Δt=2, F_avg=0.5, Q_avg=0.9, λ=0.05 → 0.18
// ---------------------------------------------------------------------------

function computeScore(
  c0: number,
  fAvg: number,
  qAvg: number,
  decayFactor: number,
): number {
  return c0 * fAvg * qAvg * decayFactor;
}

export const model = {
  type: "rave/confidence-engine",
  version: "2026.03.21.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    confidence: {
      description: "Computed confidence state for this claim",
      schema: ConfidenceSchema,
      lifetime: "infinite",
      garbageCollection: 500,
    },
  },
  methods: {
    compute: {
      description: "Apply the RAVE decay formula to produce an updated confidence score for this claim",
      arguments: z.object({
        currentScore: z.number(),
        lastValidated: z.string(),
        currentStatus: z.string(),
        evidence: z.array(EvidenceInputSchema),
      }),
      execute: async (args, context) => {
        const { claimId, decayLambda, confidenceFloor } = context.globalArgs;
        const now = new Date();
        const computedAt = now.toISOString();

        // Read previous score for transition tracking
        let previousScore: number | null = null;
        try {
          const prev = await context.readResource("confidence", "current");
          previousScore = (prev as { confidenceScore: number }).confidenceScore ?? null;
        } catch {
          // No previous record — first run
        }

        // Skip computation for terminal/inactive statuses
        if (args.currentStatus === "draft" || args.currentStatus === "contradicted") {
          context.logger.info(`Claim '${claimId}' is ${args.currentStatus} — returning 0.0`);
          const handle = await context.writeResource("confidence", "current", {
            claimId,
            confidenceScore: 0.0,
            previousScore,
            fAvg: 0.0,
            qAvg: 0.0,
            decayFactor: 1.0,
            lastValidated: args.lastValidated,
            computedAt,
            evidenceSnapshots: [],
            statusTransition: previousScore !== null && previousScore > 0
              ? `${args.currentStatus}→0.0`
              : null,
          });
          return { dataHandles: [handle] };
        }

        if (args.currentStatus === "retired") {
          context.logger.info(`Claim '${claimId}' is retired — returning frozen score`);
          const handle = await context.writeResource("confidence", "current", {
            claimId,
            confidenceScore: args.currentScore,
            previousScore,
            fAvg: 1.0,
            qAvg: 1.0,
            decayFactor: 1.0,
            lastValidated: args.lastValidated,
            computedAt,
            evidenceSnapshots: [],
            statusTransition: null,
          });
          return { dataHandles: [handle] };
        }

        // No evidence → score collapses to 0
        if (args.evidence.length === 0) {
          context.logger.warn(`Claim '${claimId}' has no evidence — score = 0.0`);
          const handle = await context.writeResource("confidence", "current", {
            claimId,
            confidenceScore: 0.0,
            previousScore,
            fAvg: 0.0,
            qAvg: 0.0,
            decayFactor: 1.0,
            lastValidated: args.lastValidated,
            computedAt,
            evidenceSnapshots: [],
            statusTransition: null,
          });
          return { dataHandles: [handle] };
        }

        // Compute per-evidence freshness and quality contributions
        const snapshots: z.infer<typeof EvidenceSnapshotSchema>[] = [];
        let fSum = 0;
        let qSum = 0;

        for (const ev of args.evidence) {
          const stale = isStaleCheck(ev.timestamp, ev.freshnessWindow);
          // fail outcome or stale → freshness contribution = 0
          const freshnessContribution = (ev.outcome === "fail" || stale) ? 0.0 : 1.0;
          const qualityScore = ev.qualityScore ?? 1.0;

          fSum += freshnessContribution;
          qSum += qualityScore;

          snapshots.push({
            evidenceId: ev.evidenceId,
            outcome: ev.outcome,
            isStale: stale,
            qualityScore,
            freshnessContribution,
          });
        }

        const fAvg = fSum / args.evidence.length;
        const qAvg = qSum / args.evidence.length;

        // Decay: Δt in days
        const deltaDays =
          (now.getTime() - new Date(args.lastValidated).getTime()) / (1000 * 60 * 60 * 24);
        const decayFactor = Math.exp(-decayLambda * deltaDays);

        let score = computeScore(args.currentScore, fAvg, qAvg, decayFactor);

        // Apply floor
        if (score > 0 && score < confidenceFloor) score = 0.0;

        // Round to 4 decimal places to avoid floating-point noise
        score = Math.round(score * 10000) / 10000;

        context.logger.info(
          `Claim '${claimId}': C₀=${args.currentScore} × F_avg=${fAvg.toFixed(3)} × Q_avg=${qAvg.toFixed(3)} × decay=${decayFactor.toFixed(4)} = ${score}`,
        );

        const statusTransition = previousScore !== null && Math.abs(previousScore - score) > 0.001
          ? `${previousScore.toFixed(3)}→${score.toFixed(3)}`
          : null;

        const handle = await context.writeResource("confidence", "current", {
          claimId,
          confidenceScore: score,
          previousScore,
          fAvg,
          qAvg,
          decayFactor,
          lastValidated: args.lastValidated,
          computedAt,
          evidenceSnapshots: snapshots,
          statusTransition,
        });

        return { dataHandles: [handle] };
      },
    },

    revalidate: {
      description: "Reset the confidence anchor when a claim owner formally re-attests",
      arguments: z.object({
        newScore: z.number().min(0).max(1),
        revalidatedBy: z.string(),
      }),
      execute: async (args, context) => {
        const { claimId } = context.globalArgs;
        const now = new Date().toISOString();

        let previousScore: number | null = null;
        try {
          const prev = await context.readResource("confidence", "current");
          previousScore = (prev as { confidenceScore: number }).confidenceScore ?? null;
        } catch {
          // No previous record
        }

        context.logger.info(
          `Claim '${claimId}' revalidated by '${args.revalidatedBy}': ${previousScore} → ${args.newScore}`,
        );

        const handle = await context.writeResource("confidence", "current", {
          claimId,
          confidenceScore: args.newScore,
          previousScore,
          fAvg: 1.0,
          qAvg: 1.0,
          decayFactor: 1.0,
          lastValidated: now,
          computedAt: now,
          evidenceSnapshots: [],
          statusTransition: previousScore !== null
            ? `revalidated: ${previousScore.toFixed(3)}→${args.newScore.toFixed(3)}`
            : null,
        });

        return { dataHandles: [handle] };
      },
    },
  },
};

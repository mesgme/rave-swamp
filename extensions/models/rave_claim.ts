import { z } from "npm:zod@4";
import * as YAML from "npm:yaml@2";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const GlobalArgsSchema = z.object({
  claimId: z.string(),
});

const ClaimStateSchema = z.object({
  claimId: z.string(),
  status: z.string(),
  statement: z.string(),
  category: z.string(),
  updatedAt: z.string(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function claimsPath(repoDir: string, claimId: string): string {
  return `${repoDir}/rave/claims/${claimId}.yaml`;
}

async function readClaim(path: string): Promise<Record<string, unknown>> {
  const text = await Deno.readTextFile(path);
  return YAML.parse(text) as Record<string, unknown>;
}

async function writeClaim(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  const text = YAML.stringify(data, { lineWidth: 0 });
  await Deno.writeTextFile(path, text);
}

function nowISO(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const model = {
  type: "@mellens/rave/claim",
  version: "2026.03.22.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    state: {
      description:
        "Current claim state snapshot (mirrors key fields from the YAML)",
      schema: ClaimStateSchema,
      lifetime: "infinite",
      garbageCollection: 100,
    },
  },
  methods: {
    create: {
      description:
        "Write a new claim YAML to rave/claims/ and record its initial state",
      arguments: z.object({
        statement: z.string(),
        owner: z.string(),
        team: z.string().optional(),
        contact: z.string().optional(),
        category: z.string(),
        scopeType: z.string(),
        scopeTarget: z.string(),
        decayLambda: z.coerce.number().default(0.05),
        assumptions: z.array(z.string()).default([]),
        falsificationSignals: z.array(z.string()).default([]),
      }),
      execute: async (args, context) => {
        const { claimId } = context.globalArgs;
        const path = claimsPath(context.repoDir, claimId);

        // Refuse to overwrite an existing claim
        try {
          await Deno.stat(path);
          throw new Error(
            `Claim '${claimId}' already exists at ${path} — use update methods instead`,
          );
        } catch (err) {
          if (!(err instanceof Deno.errors.NotFound)) throw err;
        }

        const owner: Record<string, unknown> = { name: args.owner };
        if (args.team) owner.team = args.team;
        if (args.contact) owner.contact = args.contact;

        const claim: Record<string, unknown> = {
          claim_id: claimId,
          statement: args.statement,
          owner,
          status: "draft",
          category: args.category,
          scope: { type: args.scopeType, target: args.scopeTarget },
          decay_lambda: args.decayLambda,
          assumptions: args.assumptions,
          falsification_signals: args.falsificationSignals,
          annotations: [],
        };

        await writeClaim(path, claim);
        context.logger.info(
          `Created claim '${claimId}' at ${path} (status=draft)`,
        );

        const handle = await context.writeResource("state", "current", {
          claimId,
          status: "draft",
          statement: args.statement,
          category: args.category,
          updatedAt: nowISO(),
        });

        return { dataHandles: [handle] };
      },
    },

    get: {
      description: "Read the current claim YAML and record a state snapshot",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const { claimId } = context.globalArgs;
        const path = claimsPath(context.repoDir, claimId);
        const claim = await readClaim(path);

        context.logger.info(
          `Claim '${claimId}': status=${claim.status} category=${claim.category}`,
        );

        const handle = await context.writeResource("state", "current", {
          claimId,
          status: String(claim.status ?? "unknown"),
          statement: String(claim.statement ?? ""),
          category: String(claim.category ?? ""),
          updatedAt: nowISO(),
        });

        return { dataHandles: [handle] };
      },
    },

    activate: {
      description:
        "Set claim status to 'active' — use once evidence is wired up",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const { claimId } = context.globalArgs;
        const path = claimsPath(context.repoDir, claimId);
        const claim = await readClaim(path);

        const prev = String(claim.status);
        claim.status = "active";
        await writeClaim(path, claim);

        context.logger.info(`Claim '${claimId}': ${prev} → active`);

        const handle = await context.writeResource("state", "current", {
          claimId,
          status: "active",
          statement: String(claim.statement ?? ""),
          category: String(claim.category ?? ""),
          updatedAt: nowISO(),
        });

        return { dataHandles: [handle] };
      },
    },

    retire: {
      description:
        "Set claim status to 'retired' — freezes the confidence score",
      arguments: z.object({
        reason: z.string().optional(),
      }),
      execute: async (args, context) => {
        const { claimId } = context.globalArgs;
        const path = claimsPath(context.repoDir, claimId);
        const claim = await readClaim(path);

        const prev = String(claim.status);
        claim.status = "retired";

        if (args.reason) {
          const annotations = (claim.annotations as unknown[]) ?? [];
          annotations.push({
            text: `Retired: ${args.reason}`,
            author: "rave/claim",
            created_at: nowISO(),
          });
          claim.annotations = annotations;
        }

        await writeClaim(path, claim);
        context.logger.info(`Claim '${claimId}': ${prev} → retired`);

        const handle = await context.writeResource("state", "current", {
          claimId,
          status: "retired",
          statement: String(claim.statement ?? ""),
          category: String(claim.category ?? ""),
          updatedAt: nowISO(),
        });

        return { dataHandles: [handle] };
      },
    },

    contradict: {
      description:
        "Set claim status to 'contradicted' — collapses confidence to 0",
      arguments: z.object({
        reason: z.string(),
      }),
      execute: async (args, context) => {
        const { claimId } = context.globalArgs;
        const path = claimsPath(context.repoDir, claimId);
        const claim = await readClaim(path);

        const prev = String(claim.status);
        claim.status = "contradicted";

        const annotations = (claim.annotations as unknown[]) ?? [];
        annotations.push({
          text: `Contradicted: ${args.reason}`,
          author: "rave/claim",
          created_at: nowISO(),
        });
        claim.annotations = annotations;

        await writeClaim(path, claim);
        context.logger.warn(
          `Claim '${claimId}': ${prev} → contradicted — ${args.reason}`,
        );

        const handle = await context.writeResource("state", "current", {
          claimId,
          status: "contradicted",
          statement: String(claim.statement ?? ""),
          category: String(claim.category ?? ""),
          updatedAt: nowISO(),
        });

        return { dataHandles: [handle] };
      },
    },

    annotate: {
      description: "Add a free-text annotation to the claim YAML",
      arguments: z.object({
        text: z.string(),
        author: z.string(),
      }),
      execute: async (args, context) => {
        const { claimId } = context.globalArgs;
        const path = claimsPath(context.repoDir, claimId);
        const claim = await readClaim(path);

        const annotations = (claim.annotations as unknown[]) ?? [];
        annotations.push({
          text: args.text,
          author: args.author,
          created_at: nowISO(),
        });
        claim.annotations = annotations;

        await writeClaim(path, claim);
        context.logger.info(
          `Claim '${claimId}': annotation added by '${args.author}'`,
        );

        const handle = await context.writeResource("state", "current", {
          claimId,
          status: String(claim.status ?? "unknown"),
          statement: String(claim.statement ?? ""),
          category: String(claim.category ?? ""),
          updatedAt: nowISO(),
        });

        return { dataHandles: [handle] };
      },
    },
  },
};

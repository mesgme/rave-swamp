import { z } from "npm:zod@4";
import { parse as parseYaml } from "npm:yaml@2.7.0";
import { join } from "jsr:@std/path@1";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const NodeEntrySchema = z.object({
  nodeId: z.string(),
  nodeType: z.enum(["fact", "claim", "validation", "capability"]),
  status: z.string().default("active"),
  confidenceScore: z.coerce.number(),
});

const EvaluateArgsSchema = z.object({
  scopeType: z.string().default("repository"),
  scopeTarget: z.string().default("mesgme/rave-swamp"),
  threshold: z.coerce.number().min(0).max(1).default(0.7),
  includeDescendants: z.coerce.boolean().default(true),
  nodes: z.array(NodeEntrySchema),
});

const EvaluatedNodeSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  confidence: z.number(),
  aboveThreshold: z.boolean(),
  reason: z.string().optional(),
});

const FailingNodeSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  confidence: z.number(),
  threshold: z.number(),
  reason: z.string(),
  suggestedRemediation: z.string().optional(),
});

const AssessmentSchema = z.object({
  raveVersion: z.literal("0.2.0"),
  scope: z.object({ type: z.string(), target: z.string() }),
  threshold: z.number(),
  evaluatedAt: z.string(),
  ready: z.boolean(),
  summary: z.string(),
  includeDescendants: z.boolean(),
  evaluatedNodes: z.array(EvaluatedNodeSchema),
  failingNodes: z.array(FailingNodeSchema),
  propagationTrace: z.array(
    z.object({
      sourceId: z.string(),
      propagatedTo: z.string(),
      edgeType: z.string(),
      impact: z.string(),
    }),
  ).default([]),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RawNodeFile {
  claim_id?: string;
  fact_id?: string;
  validation_id?: string;
  capability_id?: string;
  scope?: { type?: string; target?: string };
  status?: string;
}

function nodeIdFromRaw(raw: RawNodeFile): string | undefined {
  return (
    raw.claim_id ??
      raw.fact_id ??
      raw.validation_id ??
      raw.capability_id
  );
}

function nodeTypeFromSubdir(
  subdir: string,
): z.infer<typeof NodeEntrySchema>["nodeType"] {
  const map: Record<string, z.infer<typeof NodeEntrySchema>["nodeType"]> = {
    claims: "claim",
    facts: "fact",
    validations: "validation",
    capabilities: "capability",
  };
  return map[subdir] ?? "claim";
}

async function loadNodesFromDisk(
  repoDir: string,
): Promise<
  Array<
    {
      nodeId: string;
      nodeType: z.infer<typeof NodeEntrySchema>["nodeType"];
      scopeType: string;
      scopeTarget: string;
    }
  >
> {
  const subdirs = ["claims", "facts", "validations", "capabilities"];
  const result: Array<
    {
      nodeId: string;
      nodeType: z.infer<typeof NodeEntrySchema>["nodeType"];
      scopeType: string;
      scopeTarget: string;
    }
  > = [];

  for (const subdir of subdirs) {
    const dir = join(repoDir, "rave", subdir);
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const e of Deno.readDir(dir)) {
        if (e.isFile && e.name.endsWith(".yaml")) entries.push(e);
      }
    } catch {
      continue;
    }
    for (const entry of entries) {
      const text = await Deno.readTextFile(join(dir, entry.name));
      const raw = parseYaml(text) as RawNodeFile;
      const nodeId = nodeIdFromRaw(raw);
      if (!nodeId) continue;
      result.push({
        nodeId,
        nodeType: nodeTypeFromSubdir(subdir),
        scopeType: raw.scope?.type ?? "",
        scopeTarget: raw.scope?.target ?? "",
      });
    }
  }
  return result;
}

function inScope(
  nodeScopeType: string,
  nodeScopeTarget: string,
  filterType: string,
  filterTarget: string,
  includeDescendants: boolean,
): boolean {
  if (nodeScopeType === filterType && nodeScopeTarget === filterTarget) {
    return true;
  }
  if (includeDescendants && nodeScopeTarget.startsWith(filterTarget + "/")) {
    return true;
  }
  return false;
}

function evaluateNode(
  nodeId: string,
  nodeType: string,
  status: string,
  confidenceScore: number,
  threshold: number,
): {
  evaluated: z.infer<typeof EvaluatedNodeSchema>;
  failing: z.infer<typeof FailingNodeSchema> | null;
} {
  if (status === "draft" || status === "retired") {
    return {
      evaluated: {
        nodeId,
        nodeType,
        confidence: confidenceScore,
        aboveThreshold: true,
        reason: `${status} — excluded from readiness gate`,
      },
      failing: null,
    };
  }
  if (status === "contradicted") {
    const reason = "Contradicted — requires revision";
    return {
      evaluated: {
        nodeId,
        nodeType,
        confidence: confidenceScore,
        aboveThreshold: false,
        reason,
      },
      failing: {
        nodeId,
        nodeType,
        confidence: confidenceScore,
        threshold,
        reason,
      },
    };
  }
  if (status === "unknown") {
    const reason = "Status unknown — no runtime data available";
    return {
      evaluated: {
        nodeId,
        nodeType,
        confidence: 0,
        aboveThreshold: false,
        reason,
      },
      failing: { nodeId, nodeType, confidence: 0, threshold, reason },
    };
  }
  // active (or any unrecognised status treated as active)
  const aboveThreshold = confidenceScore >= threshold;
  if (aboveThreshold) {
    return {
      evaluated: {
        nodeId,
        nodeType,
        confidence: confidenceScore,
        aboveThreshold: true,
      },
      failing: null,
    };
  }
  const reason = `Confidence ${
    confidenceScore.toFixed(3)
  } below threshold ${threshold}`;
  return {
    evaluated: {
      nodeId,
      nodeType,
      confidence: confidenceScore,
      aboveThreshold: false,
      reason,
    },
    failing: {
      nodeId,
      nodeType,
      confidence: confidenceScore,
      threshold,
      reason,
    },
  };
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const model = {
  type: "@mellens/rave/readiness-reporter",
  version: "2026.05.07.1",
  resources: {
    report: {
      description: "Latest v0.2 readiness assessment",
      schema: AssessmentSchema,
      lifetime: "7d",
      garbageCollection: 50,
    },
  },
  methods: {
    evaluate: {
      description:
        "Evaluate readiness for a scope by comparing confidence scores to threshold. Reads all node YAML files from disk to discover in-scope nodes; cross-references with the nodes input for runtime status and scores. Emits a v0.2 readiness assessment.",
      arguments: EvaluateArgsSchema,
      execute: async (args: z.infer<typeof EvaluateArgsSchema>, context: {
        repoDir: string;
        logger: { info: (m: string) => void; warn: (m: string) => void };
        writeResource: (
          resource: string,
          slot: string,
          data: unknown,
        ) => Promise<unknown>;
      }) => {
        const evaluatedAt = new Date().toISOString();
        const { scopeType, scopeTarget, threshold, includeDescendants, nodes } =
          args;

        // Build lookup map from input nodes array
        const nodeMap = new Map(nodes.map((n) => [n.nodeId, n]));

        // Discover all nodes from disk, filter by scope
        const diskNodes = await loadNodesFromDisk(context.repoDir);
        const scopedNodes = diskNodes.filter((n) =>
          inScope(
            n.scopeType,
            n.scopeTarget,
            scopeType,
            scopeTarget,
            includeDescendants,
          )
        );

        const evaluatedNodes: z.infer<typeof EvaluatedNodeSchema>[] = [];
        const failingNodes: z.infer<typeof FailingNodeSchema>[] = [];

        for (const diskNode of scopedNodes) {
          const runtime = nodeMap.get(diskNode.nodeId);
          if (!runtime) {
            context.logger.warn(
              `Node ${diskNode.nodeId} in scope but missing from nodes input — treating as unknown/failing`,
            );
            const { evaluated, failing } = evaluateNode(
              diskNode.nodeId,
              diskNode.nodeType,
              "unknown",
              0,
              threshold,
            );
            evaluatedNodes.push(evaluated);
            if (failing) failingNodes.push(failing);
            continue;
          }
          const { evaluated, failing } = evaluateNode(
            runtime.nodeId,
            runtime.nodeType,
            runtime.status,
            runtime.confidenceScore,
            threshold,
          );
          evaluatedNodes.push(evaluated);
          if (failing) failingNodes.push(failing);
        }

        const activeNodes = evaluatedNodes.filter(
          (n) =>
            n.reason !== `draft — excluded from readiness gate` &&
            n.reason !== `retired — excluded from readiness gate`,
        );
        const ready = failingNodes.length === 0;

        const passing = activeNodes.filter((n) => n.aboveThreshold).length;
        const excluded = evaluatedNodes.length - activeNodes.length;
        const summary = [
          `${passing} of ${activeNodes.length} active nodes meet threshold (${threshold}).`,
          excluded > 0 ? `${excluded} node(s) excluded (draft/retired).` : "",
        ].filter(Boolean).join(" ");

        if (ready) {
          context.logger.info(
            `Readiness [${scopeType}/${scopeTarget}]: READY — ${summary}`,
          );
        } else {
          context.logger.warn(
            `Readiness [${scopeType}/${scopeTarget}]: NOT READY — ${summary}`,
          );
          for (const f of failingNodes) {
            context.logger.warn(`  ✗ ${f.nodeId}: ${f.reason}`);
          }
        }

        const assessment: z.infer<typeof AssessmentSchema> = {
          raveVersion: "0.2.0",
          scope: { type: scopeType, target: scopeTarget },
          threshold,
          evaluatedAt,
          ready,
          summary,
          includeDescendants,
          evaluatedNodes,
          failingNodes,
          propagationTrace: [],
        };

        const handle = await context.writeResource(
          "report",
          "current",
          assessment,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};

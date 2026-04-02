import type { ConfidenceData } from "./types.ts";

/** Parse a swamp data get JSON response into ConfidenceData, or null if invalid. */
export function parseConfidenceResponse(raw: string): ConfidenceData | null {
  if (!raw || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw);
    const attrs = parsed?.content ?? parsed?.attributes;
    if (!attrs || typeof attrs.confidenceScore !== "number") return null;
    return {
      claimId: attrs.claimId,
      confidenceScore: attrs.confidenceScore,
      previousScore: attrs.previousScore ?? null,
      computedAt: attrs.computedAt,
      lastValidated: attrs.lastValidated,
      fAvg: attrs.fAvg,
      qAvg: attrs.qAvg,
      decayFactor: attrs.decayFactor,
      statusTransition: attrs.statusTransition ?? null,
    };
  } catch {
    return null;
  }
}

/** Fetch confidence data for a single claim via swamp CLI. */
async function fetchOne(claimId: string): Promise<ConfidenceData | null> {
  const modelName = `confidence-${claimId}`;
  try {
    const cmd = new Deno.Command("swamp", {
      args: ["data", "get", modelName, "current", "--json"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) return null;
    const text = new TextDecoder().decode(output.stdout);
    return parseConfidenceResponse(text);
  } catch {
    return null;
  }
}

/** Fetch confidence data for all claims in parallel. */
export async function fetchAllConfidence(
  claimIds: string[],
): Promise<Map<string, ConfidenceData>> {
  const results = await Promise.allSettled(
    claimIds.map(async (id) => ({ id, data: await fetchOne(id) })),
  );
  const map = new Map<string, ConfidenceData>();
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.data) {
      map.set(result.value.id, result.value.data);
    }
  }
  return map;
}

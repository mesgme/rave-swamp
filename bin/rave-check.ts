import { parseScopeFile, flattenScopes } from "./lib/scopes.ts";
import { parseClaimFiles } from "./lib/claims.ts";
import { fetchAllConfidence } from "./lib/confidence.ts";
import { confidenceLevel } from "./lib/render.ts";
import type { Claim, ConfidenceData, ConfidenceLevel } from "./lib/types.ts";

export interface CheckClaimRow {
  claimId: string;
  score: number;
  level: ConfidenceLevel;
  guidance: string[];
}

export interface CheckResult {
  ok: boolean;
  claims: CheckClaimRow[];
}

/** Pure check logic — exported for unit testing. */
export function checkClaims(
  claims: Claim[],
  confidence: Map<string, ConfidenceData>,
  threshold: number,
): CheckResult {
  const failing: CheckClaimRow[] = [];

  for (const claim of claims) {
    if (claim.status !== "active") continue;

    const conf = confidence.get(claim.claim_id);
    const score = conf?.confidenceScore ?? 0;
    const guidance = conf?.guidance ?? [];
    const level = confidenceLevel(score);

    if (score < threshold || guidance.length > 0) {
      failing.push({ claimId: claim.claim_id, score, level, guidance });
    }
  }

  return { ok: failing.length === 0, claims: failing };
}

async function main() {
  const repoDir = Deno.args.find((a) => !a.startsWith("-")) ?? ".";
  const threshold = 0.7;

  const scopeTree = await parseScopeFile(`${repoDir}/rave/scopes/rave-swamp.yaml`);
  const _flatScopes = flattenScopes(scopeTree);
  const claims = await parseClaimFiles(`${repoDir}/rave/claims`);
  const confidence = await fetchAllConfidence(claims.map((c) => c.claim_id));

  const result = checkClaims(claims, confidence, threshold);

  console.log(JSON.stringify(result, null, 2));
  Deno.exit(result.ok ? 0 : 1);
}

if (import.meta.main) main();

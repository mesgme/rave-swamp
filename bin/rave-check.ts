import { flattenScopes, parseScopeFile } from "./lib/scopes.ts";
import { parseClaimFiles } from "./lib/claims.ts";
import { fetchAllConfidence } from "./lib/confidence.ts";
import { confidenceLevel } from "./lib/render.ts";
import type { Claim, ConfidenceData, ConfidenceLevel } from "./lib/types.ts";
import { type CveFinding, scanLockfile } from "./rave-cve-scan.ts";

const CVE_CLAIM_ID = "claim-no-known-cves-001";

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

/**
 * Inject CVE findings as guidance into the confidence map for claim-no-known-cves-001.
 * Exported for unit testing.
 */
export function injectCveFindings(
  confidence: Map<string, ConfidenceData>,
  findings: CveFinding[],
): void {
  if (findings.length === 0) return;
  const existing = confidence.get(CVE_CLAIM_ID);
  const guidance = findings.map((f) => {
    const fix = f.fixedVersion ? ` (fixed in ${f.fixedVersion})` : "";
    return `${f.osvId} [${f.severity}] ${f.pkg}@${f.version}${fix}`;
  });
  confidence.set(CVE_CLAIM_ID, {
    claimId: CVE_CLAIM_ID,
    confidenceScore: existing?.confidenceScore ?? 0,
    previousScore: existing?.previousScore ?? null,
    computedAt: existing?.computedAt ?? "",
    lastValidated: existing?.lastValidated ?? "",
    fAvg: existing?.fAvg ?? 0,
    qAvg: existing?.qAvg ?? 0,
    decayFactor: existing?.decayFactor ?? 0,
    statusTransition: existing?.statusTransition ?? null,
    guidance: [...(existing?.guidance ?? []), ...guidance],
  });
}

async function main() {
  const repoDir = Deno.args.find((a) => !a.startsWith("-")) ?? ".";
  const threshold = 0.7;

  const scopeTree = await parseScopeFile(
    `${repoDir}/rave/scopes/rave-swamp.yaml`,
  );
  const _flatScopes = flattenScopes(scopeTree);
  const claims = await parseClaimFiles(`${repoDir}/rave/claims`);
  const confidence = await fetchAllConfidence(claims.map((c) => c.claim_id));

  const cveResult = await scanLockfile(`${repoDir}/deno.lock`);
  injectCveFindings(confidence, cveResult.findings);

  const result = checkClaims(claims, confidence, threshold);

  console.log(JSON.stringify(result, null, 2));
  Deno.exit(result.ok ? 0 : 1);
}

if (import.meta.main) main();

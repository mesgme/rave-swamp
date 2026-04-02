import { parseScopeFile, flattenScopes } from "./lib/scopes.ts";
import { parseClaimFiles } from "./lib/claims.ts";
import { fetchAllConfidence } from "./lib/confidence.ts";
import { renderDashboard, confidenceLevel } from "./lib/render.ts";
import type { DashboardState } from "./lib/types.ts";

const CLEAR = "\x1b[2J\x1b[H";
const SHOW_CURSOR = "\x1b[?25h";
const HIDE_CURSOR = "\x1b[?25l";

async function loadState(repoDir: string, threshold: number): Promise<DashboardState> {
  const scopeTree = await parseScopeFile(`${repoDir}/rave/scopes/rave-swamp.yaml`);
  const flatScopes = flattenScopes(scopeTree);
  const claims = await parseClaimFiles(`${repoDir}/rave/claims`);
  const confidence = await fetchAllConfidence(claims.map((c) => c.claim_id));

  return {
    scopeTree,
    flatScopes,
    claims,
    confidence,
    selectedScopeIndex: 0,
    threshold,
  };
}

function outputJson(state: DashboardState) {
  const rows = state.claims.map((claim) => {
    const conf = state.confidence.get(claim.claim_id);
    return {
      claimId: claim.claim_id,
      status: claim.status,
      category: claim.category,
      scope: claim.scopeKey,
      confidenceScore: conf?.confidenceScore ?? null,
      previousScore: conf?.previousScore ?? null,
      computedAt: conf?.computedAt ?? null,
      level: conf ? confidenceLevel(conf.confidenceScore) : "unknown",
    };
  });
  const scopes = state.flatScopes.map((s) => ({
    key: s.key,
    type: s.type,
    target: s.target,
    description: s.description,
  }));
  console.log(JSON.stringify({ scopes, claims: rows, threshold: state.threshold }, null, 2));
}

function draw(state: DashboardState) {
  const output = renderDashboard(state);
  Deno.stdout.writeSync(new TextEncoder().encode(CLEAR + HIDE_CURSOR + output));
}

async function main() {
  const args = new Set(Deno.args);
  const repoDir = Deno.args.find((a) => !a.startsWith("-")) ?? ".";
  const threshold = 0.7;
  const jsonMode = args.has("--json");

  const state = await loadState(repoDir, threshold);

  if (jsonMode) {
    outputJson(state);
    return;
  }

  // Interactive TUI
  Deno.stdin.setRaw(true);
  draw(state);

  const buf = new Uint8Array(8);
  try {
    while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null) break;

      const input = new TextDecoder().decode(buf.subarray(0, n!));

      if (input === "q" || input === "\x03") {
        // q or Ctrl+C
        break;
      }

      if (input === "\x1b[A") {
        // Up arrow
        state.selectedScopeIndex = Math.max(0, state.selectedScopeIndex - 1);
      } else if (input === "\x1b[B") {
        // Down arrow
        state.selectedScopeIndex = Math.min(
          state.flatScopes.length - 1,
          state.selectedScopeIndex + 1,
        );
      } else if (input === "r") {
        // Refresh confidence data
        state.confidence = await fetchAllConfidence(
          state.claims.map((c) => c.claim_id),
        );
      }

      draw(state);
    }
  } finally {
    Deno.stdin.setRaw(false);
    Deno.stdout.writeSync(new TextEncoder().encode(SHOW_CURSOR + "\n"));
  }
}

main();

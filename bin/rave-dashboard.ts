import { parseScopeFile, flattenScopes } from "./lib/scopes.ts";
import { parseClaimFiles, claimsForScope } from "./lib/claims.ts";
import { fetchAllConfidence } from "./lib/confidence.ts";
import { renderDashboard, confidenceLevel } from "./lib/render.ts";
import type { DashboardState } from "./lib/types.ts";

async function runWorkflow(name: string): Promise<boolean> {
  try {
    const cmd = new Deno.Command("swamp", {
      args: ["workflow", "run", name, "--json"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    return output.success;
  } catch {
    return false;
  }
}

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
    selectedClaimId: null,
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
      guidance: conf?.guidance ?? [],
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

function drawWithStatus(state: DashboardState, message: string) {
  const output = renderDashboard(state, message);
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

  // Check if stdin is a terminal (setRaw fails on non-TTY, e.g. piped input)
  if (!Deno.stdin.isTerminal()) {
    // Non-interactive: render once and exit
    const output = renderDashboard(state);
    console.log(output);
    return;
  }

  // Interactive TUI
  Deno.stdin.setRaw(true);
  draw(state);

  // Auto-sweep on startup
  drawWithStatus(state, "Running sweep: gathering evidence...");
  const startupEvidenceOk = await runWorkflow("gather-all-evidence");
  if (startupEvidenceOk) {
    drawWithStatus(state, "Running sweep: computing confidence...");
    await runWorkflow("confidence-decay-sweep");
  }
  state.confidence = await fetchAllConfidence(state.claims.map((c) => c.claim_id));
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
        // Up arrow — navigate scopes
        state.selectedScopeIndex = Math.max(0, state.selectedScopeIndex - 1);
        state.selectedClaimId = null;
      } else if (input === "\x1b[B") {
        // Down arrow — navigate scopes
        state.selectedScopeIndex = Math.min(
          state.flatScopes.length - 1,
          state.selectedScopeIndex + 1,
        );
        state.selectedClaimId = null;
      } else if (input === "j" || input === "k") {
        // j/k — navigate claims within the selected scope
        const selectedScope = state.flatScopes[state.selectedScopeIndex];
        const scopeClaims = claimsForScope(state.claims, selectedScope)
          .sort((a, b) => a.category.localeCompare(b.category) || a.claim_id.localeCompare(b.claim_id));
        if (scopeClaims.length > 0) {
          const currentIdx = state.selectedClaimId
            ? scopeClaims.findIndex((c) => c.claim_id === state.selectedClaimId)
            : -1;
          if (input === "j") {
            const next = Math.min(scopeClaims.length - 1, currentIdx + 1);
            state.selectedClaimId = scopeClaims[next].claim_id;
          } else {
            const prev = Math.max(0, currentIdx <= 0 ? 0 : currentIdx - 1);
            state.selectedClaimId = scopeClaims[prev].claim_id;
          }
        }
      } else if (input === "r") {
        // Refresh confidence data
        state.confidence = await fetchAllConfidence(
          state.claims.map((c) => c.claim_id),
        );
      } else if (input === "s") {
        // Run full sweep: gather evidence → compute confidence → refresh
        drawWithStatus(state, "Running sweep: gathering evidence...");
        const evidenceOk = await runWorkflow("gather-all-evidence");
        if (evidenceOk) {
          drawWithStatus(state, "Running sweep: computing confidence...");
          await runWorkflow("confidence-decay-sweep");
        }
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

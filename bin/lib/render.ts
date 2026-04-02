import type {
  Claim,
  ConfidenceData,
  ConfidenceLevel,
  DashboardState,
  ScopeNode,
} from "./types.ts";
import { claimsForScope } from "./claims.ts";

// --- ANSI helpers ---

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const INVERSE = "\x1b[7m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BRIGHT_RED = "\x1b[91m";
const GRAY = "\x1b[90m";
const CYAN = "\x1b[36m";

// --- Confidence level ---

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  if (score >= 0.2) return "low";
  return "critical";
}

function colorForLevel(level: ConfidenceLevel): string {
  switch (level) {
    case "high":
      return GREEN;
    case "medium":
      return YELLOW;
    case "low":
      return RED;
    case "critical":
      return BRIGHT_RED;
    case "unknown":
      return GRAY;
  }
}

function colorize(text: string, level: ConfidenceLevel): string {
  return `${colorForLevel(level)}${text}${RESET}`;
}

// --- Scope tree rendering ---

export function renderScopeTree(
  root: ScopeNode,
  flatScopes: ScopeNode[],
  selectedIndex: number,
): string {
  const lines: string[] = [];

  function walk(node: ScopeNode, prefix: string, isLast: boolean, depth: number) {
    const flatIdx = flatScopes.indexOf(node);
    const isSelected = flatIdx === selectedIndex;
    const connector = depth === 0 ? "" : isLast ? "└─ " : "├─ ";
    const label = `${node.type}: ${node.target}`;
    const line = depth === 0
      ? `  ${label}`
      : `  ${prefix}${connector}${label}`;

    if (isSelected) {
      lines.push(`${INVERSE}${BOLD}${line}${RESET}`);
    } else {
      lines.push(`${DIM}${line}${RESET}`);
    }

    const childPrefix = depth === 0 ? "" : prefix + (isLast ? "   " : "│  ");
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i], childPrefix, i === node.children.length - 1, depth + 1);
    }
  }

  walk(root, "", true, 0);
  return lines.join("\n");
}

// --- Claims table rendering ---

function pad(str: string, width: number): string {
  // Strip ANSI codes for length calculation
  // deno-lint-ignore no-control-regex
  const visible = str.replace(/\x1b\[[0-9;]*m/g, "");
  const diff = width - visible.length;
  return diff > 0 ? str + " ".repeat(diff) : str;
}

function formatScore(conf: ConfidenceData | undefined): string {
  if (!conf) return colorize("  N/A  ", "unknown");
  const score = conf.confidenceScore.toFixed(3);
  const level = confidenceLevel(conf.confidenceScore);
  return colorize(`● ${score}`, level);
}

function formatTrend(conf: ConfidenceData | undefined): string {
  if (!conf || conf.previousScore === null) return `${GRAY}─${RESET}`;
  const diff = conf.confidenceScore - conf.previousScore;
  if (Math.abs(diff) < 0.001) return `${GRAY}─${RESET}`;
  if (diff > 0) return `${GREEN}↑ ${conf.previousScore.toFixed(3)}${RESET}`;
  return `${RED}↓ ${conf.previousScore.toFixed(3)}${RESET}`;
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
      return GREEN;
    case "contradicted":
      return BRIGHT_RED;
    case "retired":
      return GRAY;
    case "draft":
      return YELLOW;
    default:
      return RESET;
  }
}

export function renderClaimsTable(
  claims: Claim[],
  confidence: Map<string, ConfidenceData>,
): string {
  const COL = { id: 34, status: 14, category: 15, score: 12, trend: 14 };
  const W = COL.id + COL.status + COL.category + COL.score + COL.trend + 6; // 6 for separators

  const hr = "─".repeat(W);
  const lines: string[] = [];

  // Header
  lines.push(`┌${hr}┐`);
  lines.push(
    `│ ${BOLD}${pad("Claim", COL.id)}${pad("Status", COL.status)}${
      pad("Category", COL.category)
    }${pad("Confidence", COL.score)}${pad("Trend", COL.trend)}${RESET}│`,
  );
  lines.push(`├${hr}┤`);

  // Rows
  if (claims.length === 0) {
    lines.push(`│ ${GRAY}${pad("No claims in this scope", W - 2)}${RESET}│`);
  } else {
    for (const claim of claims) {
      const conf = confidence.get(claim.claim_id);
      const sc = statusColor(claim.status);
      const row = ` ${pad(claim.claim_id, COL.id)}${sc}${
        pad(claim.status, COL.status)
      }${RESET}${pad(claim.category, COL.category)}${
        pad(formatScore(conf), COL.score)
      }${pad(formatTrend(conf), COL.trend)}`;
      lines.push(`│${row}│`);
    }
  }

  lines.push(`└${hr}┘`);
  return lines.join("\n");
}

// --- Readiness summary ---

function renderReadiness(
  claims: Claim[],
  confidence: Map<string, ConfidenceData>,
  threshold: number,
): string {
  const activeClaims = claims.filter((c) => c.status === "active");
  let belowCount = 0;
  let contradictedCount = 0;
  let noDataCount = 0;

  for (const claim of activeClaims) {
    const conf = confidence.get(claim.claim_id);
    if (!conf) {
      noDataCount++;
    } else if (claim.status === "contradicted") {
      contradictedCount++;
    } else if (conf.confidenceScore < threshold) {
      belowCount++;
    }
  }

  const ready = belowCount === 0 && contradictedCount === 0 && noDataCount === 0;
  const parts: string[] = [];
  if (belowCount > 0) parts.push(`${belowCount} below threshold ${threshold.toFixed(2)}`);
  if (contradictedCount > 0) parts.push(`${contradictedCount} contradicted`);
  if (noDataCount > 0) parts.push(`${noDataCount} with no data`);

  if (ready) {
    return `${GREEN}${BOLD}Readiness: ✓ READY${RESET} ${DIM}(threshold ${threshold.toFixed(2)})${RESET}`;
  }
  return `${RED}${BOLD}Readiness: ✗ NOT READY${RESET} ${DIM}(${parts.join(", ")})${RESET}`;
}

// --- Full dashboard ---

export function renderStatusLine(message: string): string {
  return `  ${YELLOW}${BOLD}⟳ ${message}${RESET}`;
}

export function renderDashboard(state: DashboardState, statusMessage?: string): string {
  const selectedScope = state.flatScopes[state.selectedScopeIndex];
  const filteredClaims = claimsForScope(state.claims, selectedScope);
  const lines: string[] = [];

  // Title
  lines.push("");
  lines.push(`  ${BOLD}${CYAN}RAVE Dashboard${RESET} ${DIM}— ${state.scopeTree.target}${RESET}`);
  lines.push(`  ${"━".repeat(60)}`);
  lines.push("");

  // Scope tree
  lines.push(`  ${BOLD}Scopes:${RESET}`);
  lines.push(renderScopeTree(state.scopeTree, state.flatScopes, state.selectedScopeIndex));
  lines.push("");

  // Claims header
  lines.push(
    `  ${BOLD}Claims for:${RESET} ${selectedScope.key} ${DIM}(${filteredClaims.length} claims)${RESET}`,
  );
  lines.push(renderClaimsTable(filteredClaims, state.confidence));
  lines.push("");

  // Readiness
  lines.push(`  ${renderReadiness(filteredClaims, state.confidence, state.threshold)}`);
  lines.push("");

  // Status message (shown during sweep)
  if (statusMessage) {
    lines.push(renderStatusLine(statusMessage));
    lines.push("");
  }

  // Footer
  lines.push(
    `  ${DIM}[↑/↓] Navigate scopes  [s] Sweep  [r] Refresh  [q] Quit${RESET}`,
  );
  lines.push("");

  return lines.join("\n");
}

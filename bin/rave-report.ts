export interface ClaimRow {
  claimId: string;
  status: string;
  category: string;
  scope: string;
  confidenceScore: number | null;
  previousScore: number | null;
  computedAt: string | null;
  level: string;
  guidance: string[];
}

/** Render a markdown rave health report with the sentinel comment. */
export function renderHealthReport(claims: ClaimRow[], threshold: number): string {
  const active = claims.filter((c) => c.status === "active");
  const belowThreshold = active.filter(
    (c) => c.confidenceScore !== null && c.confidenceScore < threshold,
  );
  const withGuidance = active.filter((c) => c.guidance.length > 0);

  const lines: string[] = [];
  lines.push("<!-- rave-health -->");
  lines.push("## rave health report");
  lines.push("");
  lines.push("| Claim | Category | Score | Level |");
  lines.push("|---|---|---|---|");

  for (const claim of claims) {
    if (claim.status !== "active") continue;
    const score = claim.confidenceScore;
    const isBelow = score !== null && score < threshold;
    const scoreStr = score === null
      ? "—"
      : `${isBelow ? "⚠️ " : "✓ "}${score.toFixed(3)}`;
    lines.push(`| ${claim.claimId} | ${claim.category} | ${scoreStr} | ${claim.level} |`);
  }

  lines.push("");

  if (belowThreshold.length === 0 && withGuidance.length === 0) {
    lines.push(`✅ all claims are healthy (threshold ${threshold.toFixed(2)})`);
  } else {
    if (belowThreshold.length > 0) {
      lines.push(
        `**${belowThreshold.length} claim${belowThreshold.length === 1 ? "" : "s"} below threshold (${threshold.toFixed(2)})**`,
      );
    }
    if (withGuidance.length > 0) {
      lines.push("");
      lines.push("<details><summary>Guidance</summary>");
      lines.push("");
      for (const claim of withGuidance) {
        lines.push(`**${claim.claimId}**`);
        for (const item of claim.guidance) {
          lines.push(`- ${item}`);
        }
        lines.push("");
      }
      lines.push("</details>");
    }
  }

  return lines.join("\n");
}

async function main() {
  const prNumber = Deno.env.get("PR_NUMBER") ?? Deno.args[0];
  if (!prNumber) {
    console.error("Usage: rave-report.ts <pr-number>  (or set PR_NUMBER env var)");
    Deno.exit(1);
  }

  const repoDir = ".";
  const threshold = 0.7;

  // Read dashboard JSON
  const dashCmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-run=swamp",
      `${repoDir}/bin/rave-dashboard.ts`,
      "--json",
      repoDir,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const dashOutput = await dashCmd.output();
  if (!dashOutput.success) {
    const err = new TextDecoder().decode(dashOutput.stderr);
    console.error(`rave-dashboard.ts failed: ${err}`);
    Deno.exit(1);
  }

  const dashboard = JSON.parse(new TextDecoder().decode(dashOutput.stdout));
  const report = renderHealthReport(dashboard.claims as ClaimRow[], threshold);

  // Post or update PR comment
  const SENTINEL = "<!-- rave-health -->";

  // Find existing comment
  const listCmd = new Deno.Command("gh", {
    args: ["pr", "view", prNumber, "--json", "comments", "-q", ".comments[] | @json"],
    stdout: "piped",
    stderr: "piped",
  });
  const listOutput = await listCmd.output();
  const commentsText = new TextDecoder().decode(listOutput.stdout);

  let existingCommentId: string | null = null;
  for (const line of commentsText.split("\n").filter((l) => l.trim())) {
    try {
      const comment = JSON.parse(line);
      if (comment.body?.includes(SENTINEL)) {
        existingCommentId = String(comment.databaseId ?? comment.id);
        break;
      }
    } catch {
      // skip
    }
  }

  if (existingCommentId) {
    const editCmd = new Deno.Command("gh", {
      args: ["api", `repos/{owner}/{repo}/issues/comments/${existingCommentId}`, "--method", "PATCH", "-f", `body=${report}`],
      stdout: "piped",
      stderr: "piped",
    });
    await editCmd.output();
    console.log(`Updated existing rave-health comment #${existingCommentId}`);
  } else {
    const postCmd = new Deno.Command("gh", {
      args: ["pr", "comment", prNumber, "--body", report],
      stdout: "piped",
      stderr: "piped",
    });
    await postCmd.output();
    console.log("Posted new rave-health comment");
  }

  console.log(report);
}

if (import.meta.main) main();

# Security Claims in rave-swamp

This document covers the security-relevant claims tracked by rave-swamp, the evidence pipeline that keeps them fresh, and the swamp concepts that wire it all together.

---

## What is a Claim?

A **claim** is a machine-verifiable statement about the health of a system property — written in plain English, stored as a YAML file in `rave/claims/`, and backed by a continuously-computed **confidence score** (0.0–1.0).

Each claim has:

| Field | Purpose |
|---|---|
| `claim_id` | Stable identifier referenced across the pipeline |
| `category` | Classification: `security`, `change_risk`, `reliability`, `code_quality`, `process` |
| `scope` | Organisational boundary (repository, pipeline, component) |
| `status` | `draft` → `active` → `retired` or `contradicted` |
| `decay_lambda` | Rate at which the score decays without fresh evidence (per day) |
| `statement` | The plain-English property being monitored |

---

## The Security and Change-Risk Claims

### Security (category: `security`)

#### `claim-no-known-cves-001`
> No HIGH or CRITICAL CVEs exist in extension model npm dependencies

- **Scope**: `component:mesgme/rave-swamp/extensions`
- **Evidence**: `osv-scanner` runs against `deno.lock` in the validate CI workflow
- **Decay λ**: 0.05 — scores halve in roughly 14 days without fresh evidence
- **Falsification signal**: `osv-scanner` reports any HIGH or CRITICAL finding; `deno.lock` is removed from the repo

#### `claim-no-secrets-committed-001`
> No secrets or credentials are committed to the repository

- **Scope**: `pipeline:mesgme/rave-swamp/main`
- **Evidence**: `gitleaks` scans the full commit history in the validate CI workflow
- **Decay λ**: 0.05
- **Falsification signal**: `gitleaks` exits non-zero; a secret-like token appears in a committed file

---

### Change Risk (category: `change_risk`)

These three claims form the **core change-control layer** — they verify that code reaches main only through a reviewed, gated process.

#### `claim-branch-protection-001`
> The main branch requires a pull request before any commit can be merged

- **Scope**: `pipeline:mesgme/rave-swamp/main`
- **Evidence**: GitHub REST API `/repos/{repo}/branches/main/protection` — checks `required_pull_request_reviews` is present and admin enforcement is enabled
- **Decay λ**: 0.02 — the slowest-decaying claim; once set, branch protection rarely changes

#### `claim-main-commits-via-pr-001`
> Every commit on main arrived via a merged pull request — no direct pushes

- **Scope**: `pipeline:mesgme/rave-swamp/main`
- **Evidence**: `governance-check.yml` CI workflow verifies each recent commit's SHA appears as the `merge_commit_sha` of a known PR
- **Decay λ**: 0.02
- **Falsification signal**: a commit SHA on main does not appear in the PR list; a commit bypasses protection

#### `claim-merged-prs-reviewed-001`
> Every PR merged to main in the last 30 days had at least one approving review before merge

- **Scope**: `pipeline:mesgme/rave-swamp/main`
- **Evidence**: `governance-check.yml` iterates recent merged PRs via the GitHub API and checks each has at least one `APPROVED` review
- **Decay λ**: 0.03
- **Falsification signal**: a merged PR with zero approving reviews; a PR merged despite `CHANGES_REQUESTED` state

---

### Reliability (security-adjacent, category: `reliability`)

#### `claim-ci-green-on-main-001`
> All GitHub Actions workflow runs on the main branch succeed

- **Scope**: `pipeline:mesgme/rave-swamp/main`
- **Evidence**: Two sources — CI run conclusions from `validate.yml`, and GitHub API query of recent workflow runs
- **Decay λ**: 0.05
- **Why it matters for security**: a broken CI pipeline means security scans (gitleaks, osv-scanner) are no longer running

---

## The Evidence Pipeline

Three swamp workflows run the continuous monitoring loop:

```
┌─────────────────────────────────────────────────────┐
│  gather-all-evidence  (15 parallel jobs)            │
│                                                     │
│  For each claim, one or more evidence models run:   │
│  • rave_ci_evidence     → query GitHub Actions run  │
│  • rave_github_api_evidence → call GitHub REST API  │
│  • rave_prometheus_evidence → execute PromQL query  │
│                                                     │
│  Each writes a result: outcome (pass/fail/inconcl.) │
│  + timestamp + raw response to the swamp datastore  │
└────────────────────┬────────────────────────────────┘
                     │  data.latest() expressions
                     ▼
┌─────────────────────────────────────────────────────┐
│  confidence-decay-sweep  (15 parallel jobs)         │
│                                                     │
│  For each claim, rave_confidence_engine.compute():  │
│                                                     │
│    C(t) = C₀ × F_avg × Q_avg × e^(−λ × Δt)        │
│                                                     │
│  where:                                             │
│    C₀     = score at last revalidation              │
│    F_avg  = 1.0 if evidence is pass+fresh, else 0.0 │
│    Q_avg  = weighted average evidence quality       │
│    λ      = claim's decay_lambda                    │
│    Δt     = days since last validation              │
└────────────────────┬────────────────────────────────┘
                     │  triggered boolean
                     ▼
┌─────────────────────────────────────────────────────┐
│  falsifier-sweep  (15 parallel jobs)                │
│                                                     │
│  For each claim, rave_falsifier_engine.evaluate():  │
│  • threshold, boolean, regex, absence, staleness,   │
│    composite condition types                        │
│                                                     │
│  If triggered → claim status → contradicted         │
│  → confidence score collapses immediately to 0.0    │
└─────────────────────────────────────────────────────┘
```

### Confidence Score Interpretation

| Band | Score | Meaning |
|---|---|---|
| High | ≥ 0.80 | Well-evidenced, fresh evidence |
| Medium | ≥ 0.50 | Some staleness or evidence gaps |
| Low | ≥ 0.20 | Significant decay or weak evidence |
| Critical | < 0.20 | Not meaningfully supported |

Scores below the threshold (default **0.70**) trigger `⚠️` in the dashboard and in PR health-report comments.

### Decay in Practice

With λ = 0.05 and no new evidence (F_avg = 0):

| Days without evidence | Score multiplier |
|---|---|
| 0 | 1.00 |
| 7 | 0.70 |
| 14 | 0.50 |
| 28 | 0.25 |

With λ = 0.02 (branch protection, commits-via-PR), a score takes **35 days** to halve — reflecting that these settings change rarely.

---

## How swamp Wires This Together

### Models

Each evidence type is a **swamp extension model** — a TypeScript module in `extensions/models/` with a Zod schema and `execute` functions. The three evidence models are:

| Model | What it queries |
|---|---|
| `rave_ci_evidence` | GitHub Actions workflow run conclusions |
| `rave_github_api_evidence` | Any GitHub REST API endpoint (branch protection, PR reviews, commits) |
| `rave_prometheus_evidence` | PromQL queries against Prometheus/Thanos |

The `rave_confidence_engine` model holds the decay formula and writes a scored `confidence/current` resource for each claim. The `rave_falsifier_engine` evaluates contradiction conditions.

### Workflows

Workflows are YAML files that chain model method calls. Jobs reference swamp data using **CEL expressions**:

```yaml
inputs:
  evidence:
    - outcome: "${{ data.latest('evidence-no-secrets-committed-001', 'current').attributes.outcome }}"
      freshnessWindow: PT1H
      qualityScore: 0.95
```

`data.latest()` fetches the most recent snapshot written by the gather step, so the confidence sweep always sees current evidence without re-querying the source.

### Vault

The `rave-credentials` vault stores the `GITHUB_TOKEN` used by all GitHub-touching evidence jobs. Workflow steps reference it as:

```yaml
env:
  GITHUB_TOKEN: "${{ vault.get('rave-credentials', 'GITHUB_TOKEN') }}"
```

This keeps credentials out of workflow YAML and out of source control.

### Tamper Detection

A dedicated `rave-tamper-check.yml` GitHub Actions workflow runs on every PR. It:

1. Checks for the `rave:spec-change` label (override path for legitimate spec PRs)
2. Classifies changed files as **guarded** (`rave/claims/`, `rave/scopes/`, `workflows/workflow-*.yaml`, `extensions/models/rave_*.ts`) or non-guarded
3. Fails the PR if **both** guarded and non-guarded files appear in the same diff — the pattern indicating an agent may have silently edited claim definitions to improve its own score

This repo has `tamper_guard.enabled: false` in `rave/config.yaml` (source repo; the guard is intended for downstream adopters).

---

## Agent Back-Pressure

The rave-check CLI (`bin/rave-check.ts`) gives agents a non-interactive interface:

```bash
deno task check   # exits 0 if all claims healthy, 1 if any below threshold
```

Output is structured JSON with per-claim score, level, and `guidance[]` — actionable text surfaced from failed evidence records explaining what to fix and how.

The `CLAUDE.md` rule requires every agent to run `deno task check` before declaring a task complete, and to surface any failing claim's guidance to the user before marking the work done.

---

## Security Claim Summary

| Claim | Category | λ | Evidence source | Falsification |
|---|---|---|---|---|
| `claim-no-known-cves-001` | security | 0.05 | osv-scanner on deno.lock | HIGH/CRITICAL CVE found |
| `claim-no-secrets-committed-001` | security | 0.05 | gitleaks full history scan | gitleaks non-zero exit |
| `claim-branch-protection-001` | change_risk | 0.02 | GitHub branch protection API | protection disabled or missing |
| `claim-main-commits-via-pr-001` | change_risk | 0.02 | PR merge SHA cross-reference | commit not in any PR |
| `claim-merged-prs-reviewed-001` | change_risk | 0.03 | GitHub PR review API | PR merged without approval |
| `claim-ci-green-on-main-001` | reliability | 0.05 | GitHub Actions run conclusions | workflow failure on main |

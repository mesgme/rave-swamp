<img width="1536" height="1024" alt="ChatGPT Image Mar 30, 2026, 02_46_43 PM" src="https://github.com/user-attachments/assets/f4cea83c-d17c-4934-95ec-c70203551921" />


# rave-swamp Usage Guide

RAVE claims and evidence are managed through a combination of:
- **YAML files** in `rave/` — source of truth for entity configuration (versioned in git)
- **swamp model data** — runtime state (confidence scores, evidence results, evaluation history)

All changes to YAML files must go through a PR (branch protection is enforced).

---

## Claims

### Create a claim

```bash
# 1. Create the swamp model instance
swamp model create rave/claim claim-<id> --global-arg claimId=claim-<id>

# 2. Write the claim YAML (creates rave/claims/claim-<id>.yaml)
swamp model method run claim-<id> create \
  --input '{
    "statement": "Your claim statement here",
    "owner": "your-name",
    "contact": "#your-slack-channel",
    "category": "reliability",
    "scopeType": "repository",
    "scopeTarget": "mesgme/rave-swamp",
    "decayLambda": "0.05",
    "assumptions": ["Assumption one", "Assumption two"],
    "falsificationSignals": ["Signal that would disprove this"]
  }'

# 3. Create the confidence engine instance (one per claim)
swamp model create rave/confidence-engine confidence-<id> \
  --global-arg claimId=claim-<id> \
  --global-arg decayLambda=0.05

# 4. Commit via PR (status starts as "draft")
git checkout -b feature/add-claim-<id>
git add rave/claims/claim-<id>.yaml models/
git commit -m "Add claim-<id>"
git push -u origin feature/add-claim-<id>
gh pr create
```

**Category values:** `reliability`, `change_risk`, `security`, `observability`, `compliance`

**Scope types:** `repository`, `pipeline`, `component`

---

### Read a claim

```bash
# View the claim definition
cat rave/claims/claim-<id>.yaml

# Check current confidence score and history
swamp data list confidence-<id>

# Read the latest confidence snapshot (full detail)
swamp data get confidence-<id> current --json
```

**Example — `claim-branch-protection-001`:**

```bash
cat rave/claims/claim-branch-protection-001.yaml
swamp data list confidence-claim-branch-protection-001
```

---

### Update a claim

**Change metadata (statement, assumptions, decay lambda):**

Edit `rave/claims/<id>.yaml` directly, then commit via PR.

**Formally re-attest confidence** (reset the decay anchor):

```bash
swamp model method run confidence-<id> revalidate \
  --input '{"newScore": 0.85, "revalidatedBy": "your-name"}'
```

**Add an annotation:**

```bash
swamp model method run claim-<id> annotate \
  --input '{"text": "Validated in Q1 review. No issues found.", "author": "your-name"}'
```

The annotation is written directly to the claim YAML — commit the change via PR.

**Activate a draft claim** (once evidence is wired up):

```bash
swamp model method run claim-<id> activate
git add rave/claims/claim-<id>.yaml && git commit -m "Activate claim-<id>"
```

---

### Change claim status

| Target status | Command |
|---|---|
| `active` | `swamp model method run claim-<id> activate` |
| `retired` | `swamp model method run claim-<id> retire --input '{"reason": "..."}'` |
| `contradicted` | `swamp model method run claim-<id> contradict --input '{"reason": "..."}'` |

Status effects on confidence scoring:
- `draft` → score = 0.0 (not yet active)
- `active` → score computed from evidence and decay
- `retired` → score frozen at last value
- `contradicted` → score = 0.0

All status changes write to the YAML — commit via PR.

---

### Delete a claim

```bash
# 1. Remove the YAML
rm rave/claims/claim-<id>.yaml

# 2. Delete the claim model instance (--force required if data exists)
swamp model delete claim-<id> --force

# 3. Delete the confidence engine instance
swamp model delete confidence-<id> --force

# 4. Remove any linked falsifiers
rm rave/falsifiers/falsifier-*-<id>-*.yaml          # if any exist
swamp model delete falsifier-*-<id>-* --force        # if any exist

# 5. Commit via PR
git add -u && git commit -m "Remove claim-<id>"
```

---

## Evidence

### Gather evidence manually

```bash
# Gather CI evidence for a specific model
swamp workflow run gather-ci-evidence \
  --input '{"evidenceModelName": "evidence-ci-test-results-001"}'

# Gather GitHub API evidence
swamp model method run evidence-github-branch-protection-001 gather \
  --input "{\"githubToken\": \"$(gh auth token)\"}"

# Gather all evidence at once (parallel jobs, allowFailure)
swamp workflow run gather-all-evidence
```

### Check evidence results

```bash
swamp data list evidence-ci-test-results-001
swamp data list evidence-github-branch-protection-001
swamp data list evidence-github-actions-runs-001
```

---

## Confidence Scores

### Compute confidence for a claim

```bash
# Pass current evidence results as inputs
swamp model method run confidence-claim-branch-protection-001 compute \
  --input '{
    "currentScore": 0.82,
    "lastValidated": "2026-03-20T00:00:00Z",
    "currentStatus": "active",
    "evidence": [{
      "evidenceId": "evidence-github-branch-protection-001",
      "outcome": "pass",
      "timestamp": "2026-03-22T08:18:54Z",
      "freshnessWindow": "PT1H",
      "qualityScore": 1.0
    }]
  }'
```

### Read confidence history

```bash
swamp data list confidence-claim-branch-protection-001
```

---

## Falsifiers

### Evaluate a falsifier

```bash
# Check whether branch protection has been removed
swamp model method run falsifier-branch-protection-missing-001 evaluate \
  --input '{
    "evidence": [{
      "evidenceId": "evidence-github-branch-protection-001",
      "outcome": "pass",
      "timestamp": "2026-03-22T08:18:54Z",
      "freshnessWindow": "PT1H",
      "value": null,
      "rawData": "<JSON from evidence result>"
    }]
  }'
```

### Check falsifier history

```bash
swamp data list falsifier-branch-protection-missing-001
```

---

## Naming Conventions

| Entity | File | Model instance |
|---|---|---|
| Claim | `rave/claims/claim-<id>.yaml` | `claim-<id>` (rave/claim) |
| Confidence engine | — | `confidence-<claim-id>` (rave/confidence-engine) |
| CI evidence | `rave/evidence/evidence-<id>.yaml` | `evidence-<id>` (rave/ci-evidence) |
| GitHub API evidence | `rave/evidence/evidence-<id>.yaml` | `evidence-<id>` (rave/github-api-evidence) |
| Falsifier | `rave/falsifiers/falsifier-<id>.yaml` | `falsifier-<id>` (rave/falsifier-engine) |

---

## Sweep Workflows

Three workflows run the full RAVE pipeline. Run them in order:

```bash
# 1. Gather fresh evidence for all claims (9 parallel jobs)
swamp workflow run gather-all-evidence --json

# 2. Recompute confidence scores with decay (8 parallel jobs)
swamp workflow run confidence-decay-sweep --json

# 3. Evaluate all falsifiers (8 parallel jobs)
swamp workflow run falsifier-sweep --json
```

All jobs use `allowFailure: true` — individual failures are non-fatal so the sweep completes even when a single evidence source is down.

### Bootstrap / recovery

Confidence scores start at 0.0 and must be seeded with `revalidate` before the
first sweep, and after any confidence collapse (stale evidence drives the score
to 0 and it stays there until a human re-attests):

```bash
# Seed initial confidence for one claim
swamp model method run confidence-claim-<id> revalidate \
  --input '{"newScore": 0.9, "revalidatedBy": "your-name"}'

# Check if evidence went stale and caused a collapse
swamp data get confidence-claim-<id> current --json
# Look for confidenceScore=0 with isStale=true in evidenceSnapshots
```

**Important:** if `gather-all-evidence` ran with stale evidence and drove a
score to 0.0, re-gathering fresh evidence is not enough — you must also run
`revalidate` to reset C₀ before the next sweep can recover the score.

---

## Readiness Check

Check whether all active claims pass the confidence threshold:

```bash
# Run with default threshold (0.7)
swamp workflow run readiness-check --json

# Run with custom threshold
swamp workflow run readiness-check --input '{"threshold": 0.8}' --json

# Read the latest readiness report
swamp data get readiness-reporter-001 latest --json
```

**Example output:**

```json
{
  "threshold": 0.7,
  "ready": true,
  "evaluatedAt": "2026-03-24T11:57:14Z",
  "claims": [
    { "claimId": "claim-branch-protection-001", "confidenceScore": 0.8999, "meetsThreshold": true },
    ...
  ],
  "summary": "5 of 5 active claims meet threshold (0.7)."
}
```

> **Note:** The readiness reporter currently evaluates 5 hardcoded claims. Issue #32 tracks
> making this dynamic so new claims are included automatically.

---

## Dashboard

A read-only TUI for viewing confidence levels across all claims, with a nested scope selector.

### Interactive mode

```bash
deno task dashboard
```

- **↑/↓** — navigate the scope tree
- **s** — run full sweep (gather evidence → compute confidence → refresh)
- **r** — refresh confidence data from swamp
- **q** — quit

Selecting a parent scope shows claims from all descendant scopes. Confidence scores are color-coded:

| Color | Range | Level |
|---|---|---|
| Green | ≥ 0.80 | High |
| Yellow | ≥ 0.50 | Medium |
| Red | ≥ 0.20 | Low |
| Bright red | < 0.20 | Critical |
| Gray | — | No data |

### JSON mode (for agents / CI)

```bash
deno task dashboard:json
```

Outputs structured JSON to stdout with all scopes, claims, confidence scores, and levels. No interactive UI.

### Permissions

The dashboard needs:
- `--allow-read` — read claim/scope YAML files from `rave/`
- `--allow-run=swamp` — invoke `swamp data get` for confidence scores

These are configured in the `deno task` definitions. To run directly:

```bash
deno run --allow-read --allow-run=swamp bin/rave-dashboard.ts [--json]
```

---

## All available model types

| Type | Purpose |
|---|---|
| `rave/claim` | CRUD operations on claim YAML files |
| `rave/confidence-engine` | Compute and track confidence scores |
| `rave/ci-evidence` | Gather evidence from GitHub Actions workflow runs |
| `rave/github-api-evidence` | Gather evidence from GitHub REST API endpoints |
| `rave/prometheus-evidence` | Gather evidence from Prometheus/Thanos/VictoriaMetrics |
| `rave/falsifier-engine` | Evaluate falsifier conditions against evidence |

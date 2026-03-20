# RAVE Entity Files

This directory contains the human-authored, git-tracked RAVE entity definitions for the rave-swamp implementation. These files are the **source of truth for entity configuration**. Runtime state (confidence scores, evidence results, falsifier evaluations) is stored as swamp model data.

## Hybrid Architecture

```
rave/                          ← you are here (entity definitions)
  claims/                      ← claim configuration, lifecycle status, assumptions
  evidence/                    ← evidence methodology config (no results)
  scopes/                      ← scope hierarchy declarations
  falsifiers/                  ← falsifier condition definitions
  incidents/                   ← machine-written incident records (created by falsifier-sweep workflow)

swamp model data               ← runtime state (managed by swamp)
  confidence-engine instances  ← confidence scores, last_validated, history
  evidence model instances     ← evidence results, timestamps, staleness
  falsifier-engine instances   ← evaluation results, last_triggered
```

## What Goes Where

| Field | YAML file | Swamp data |
|---|---|---|
| Claim statement, assumptions, owner | ✅ | |
| Claim status (draft/active/retired) | ✅ | |
| Claim `decay_lambda` | ✅ | |
| Claim `confidence_score` | | ✅ confidence-engine |
| Claim `last_validated` | | ✅ confidence-engine |
| Evidence methodology config | ✅ | |
| Evidence `freshness_window`, `quality_score` | ✅ | |
| Evidence result (outcome, value, timestamp) | | ✅ evidence model |
| Evidence `isStale` | | ✅ evidence model |
| Falsifier condition definition | ✅ | |
| Falsifier `last_evaluated`, `last_triggered` | | ✅ falsifier-engine |
| Incidents | ✅ (machine-written) | |

## Directory Structure

### `claims/`

One file per claim. Filename matches `claim_id`.

```yaml
# claim-<description>-<sequence>.yaml
claim_id: "claim-deploy-rollback-001"
statement: "..."
owner: "team-name"          # or object: {name, team, contact}
status: "draft|active|contradicted|retired"
category: "reliability"     # optional — see spec section 6.1.8
scope:
  type: "service"           # well-known scope type
  target: "payments-api"
assumptions:
  - "..."
falsification_signals:
  - "..."
decay_lambda: 0.05          # implementation extension — default 0.05 (half-life ≈14 days)
annotations: []             # append-only
```

**Do not add** `confidence_score` or `last_validated` — these are in swamp data.

### `evidence/`

One file per evidence source. Filename matches `evidence_id`. Contains methodology config only — no result data.

```yaml
# evidence-<description>-<sequence>.yaml
evidence_id: "evidence-ci-test-results-001"
type: "ci_log"              # well-known type — see spec section 6.2.3
description: "..."
reference:
  uri: "https://..."
  format: "application/json"
  authentication:
    method: "bearer_token"
    hint: "VAULT_KEY_NAME"
claim_ids:
  - "claim-deploy-rollback-001"
freshness_window: "P7D"     # ISO 8601 duration
quality_score: 0.95         # 0.0–1.0, methodology rigour
methodology:
  description: "..."
  tooling: "github-actions"
  frequency: "P1D"          # omit for ad-hoc/event-driven
  coverage: "..."
metadata: {}                # arbitrary key-value context
```

**Do not add** `result`, `timestamp` — these are in swamp data.

### `scopes/`

Multi-scope files declaring hierarchy. One file per system/domain. Filename is descriptive.

```yaml
version: "0.1.0"
description: "..."
scopes:
  - type: "system"
    target: "my-system"
    description: "..."
  - type: "service"
    target: "my-service"
    parent:
      type: "system"
      target: "my-system"
```

Well-known scope types: `system`, `application`, `service`, `component`, `endpoint`, `pipeline`, `release`, `environment`, `team`.

### `falsifiers/`

One file per falsifier. Filename matches `falsifier_id`.

```yaml
# falsifier-<description>-<sequence>.yaml
falsifier_id: "falsifier-rollback-timeout-001"
name: "Human-readable name"
description: "..."
condition:
  type: "threshold|boolean|regex|absence|staleness|composite"
  parameters: {}            # type-specific — see spec section 6.3.4
  evaluation_window: "P7D"  # optional
evidence_ids:
  - "evidence-ci-test-results-001"
claim_ids:
  - "claim-deploy-rollback-001"
metadata: {}
```

**Do not add** `last_evaluated` or `last_triggered` — these are in swamp data.

### `incidents/`

Machine-written by the `falsifier-sweep` workflow. Do not author manually unless recording a manual contradiction. Filename is the `incident_id`.

```yaml
incident_id: "incident-<timestamp>"
title: "..."
description: "..."
status: "detected|investigating|mitigated|resolved|closed"
severity: "critical|major|minor"
claim_ids:
  - "claim-deploy-rollback-001"
triggered_at: "2026-03-19T10:00:00Z"
resolved_at: null
timeline: []
remediation: null
learnings: []
evidence_ids: []
```

## Naming Conventions

| Entity | Pattern | Example |
|---|---|---|
| Claim | `claim-<description>-<NNN>.yaml` | `claim-deploy-rollback-001.yaml` |
| Evidence | `evidence-<description>-<NNN>.yaml` | `evidence-ci-test-results-001.yaml` |
| Scope file | `<system-name>.yaml` | `checkout-platform.yaml` |
| Falsifier | `falsifier-<description>-<NNN>.yaml` | `falsifier-rollback-timeout-001.yaml` |
| Incident | `incident-<unix-timestamp>.yaml` | `incident-1742385600.yaml` |

## Swamp Model Instance Naming

Each entity file has a corresponding swamp model instance named after its ID:

| YAML file | Swamp model instance |
|---|---|
| `claims/claim-deploy-rollback-001.yaml` | `confidence-claim-deploy-rollback-001` |
| `evidence/evidence-ci-test-results-001.yaml` | `evidence-ci-test-results-001` |
| `falsifiers/falsifier-rollback-timeout-001.yaml` | `falsifier-rollback-timeout-001` |

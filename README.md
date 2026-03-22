# rave-swamp

RAVE (Reliability & Validation Engineering) implementation for the `mesgme/rave-swamp` repository, built on [swamp](https://github.com/systeminit/swamp).

---

## What is RAVE?

RAVE is a claim-centric framework for making reliability **explicit, falsifiable, and continuously validated**.

Most engineering teams have SLOs, runbooks, CI pipelines, and security scans — but they rarely:

- Model reliability claims explicitly
- Link claims to structured evidence
- Track claim confidence over time
- Detect when claims silently decay
- Treat incidents as structured contradictions of claims

RAVE coordinates these elements into a coherent reliability picture.

**Core principle:** Reliability is a statement about system behaviour under defined conditions — not uptime, not dashboards.

> "The main branch requires a pull request before any commit can be merged."

That is a *reliability claim*. It has a scope, assumptions, falsification signals, evidence, and a confidence score that decays if not continuously validated.

---

## What This Repo Is

`rave-swamp` is two things at once:

1. **A reference implementation** — RAVE applied to itself. The claims, evidence, and falsifiers here govern the reliability of this codebase (CI, branch protection, extension compilation, workflow validity).
2. **A working pattern** — the canonical example of how to run RAVE on any repository using swamp extension models and workflows.

---

## Architecture

RAVE uses a hybrid model — entity definitions live in git, runtime state lives in swamp:

```
rave/                          ← git-tracked source of truth
  claims/                      ← claim statements, lifecycle, assumptions
  evidence/                    ← evidence methodology config (no results)
  falsifiers/                  ← falsifier condition definitions
  scopes/                      ← scope hierarchy declarations
  incidents/                   ← machine-written incident records

swamp model data               ← runtime state (managed by swamp)
  confidence-engine instances  ← confidence scores, decay history
  evidence model instances     ← evidence results, timestamps, staleness
  falsifier-engine instances   ← evaluation results, last triggered
```

This split means:
- Claim definitions are auditable, diffable, and PR-gated
- Runtime state is mutable, historical, and queryable
- AI agents can read both planes to assess reliability

---

## Features

### Implemented

**Claims**
- [x] Claim YAML definitions (statement, owner, scope, assumptions, falsification signals)
- [x] Claim lifecycle: `draft` → `active` → `retired` / `contradicted`
- [x] Well-known categories: `reliability`, `change_risk`, `security`, `observability`, `compliance`
- [x] Append-only annotations
- [x] `rave/claim` swamp model (create, activate, retire, contradict, annotate)

**Evidence**
- [x] Evidence methodology YAML (type, reference, freshness window, quality score)
- [x] `rave/ci-evidence` model — gather evidence from GitHub Actions workflow runs
- [x] `rave/github-api-evidence` model — query GitHub REST API endpoints (branch protection, etc.)
- [x] `rave/prometheus-evidence` model — execute PromQL queries against Prometheus/Thanos/VictoriaMetrics
- [x] `gather-ci-evidence` workflow
- [x] `gather-all-evidence` workflow (parallel, allow-failure)

**Confidence**
- [x] Exponential decay formula: `C(t) = C₀ × F_avg × Q_avg × e^(−λ × Δt)`
- [x] Per-claim configurable decay rate (`decay_lambda`)
- [x] Confidence score bands (high ≥ 0.8, medium ≥ 0.5, low ≥ 0.2, critical < 0.2)
- [x] Revalidation (manual re-attestation to reset the decay anchor)
- [x] Confidence history tracking
- [x] `rave/confidence-engine` swamp model (compute, revalidate)

**Falsifiers**
- [x] Falsifier condition YAML (condition type, parameters, evidence links, claim links)
- [x] Boolean condition type
- [x] `rave/falsifier-engine` swamp model (evaluate)

**Scopes**
- [x] Scope YAML declarations with hierarchy (`parent` references)
- [x] Well-known scope types: `system`, `application`, `service`, `component`, `endpoint`, `pipeline`, `release`, `environment`, `team`

**Existing claims for rave-swamp**
- [x] `claim-branch-protection-001` — main requires PRs
- [x] `claim-ci-green-on-main-001` — CI passes on main
- [x] `claim-extensions-compile-001` — TypeScript extensions compile
- [x] `claim-swamp-models-valid-001` — swamp models are valid
- [x] `claim-swamp-workflows-valid-001` — swamp workflows are valid

---

### Planned

**Automation workflows** (issues [#8](https://github.com/mesgme/rave-swamp/issues/8), [#9](https://github.com/mesgme/rave-swamp/issues/9), [#10](https://github.com/mesgme/rave-swamp/issues/10))
- [ ] `confidence-decay-sweep` — periodically recompute confidence for all active claims
- [ ] `falsifier-sweep` — evaluate all falsifiers, auto-create incident records when triggered
- [ ] `readiness-check` — evaluate whether all claims at a scope meet the confidence threshold

**Incidents** (blocked on #9)
- [ ] Machine-written incident records when falsifiers fire
- [ ] Incident lifecycle: `detected` → `investigating` → `mitigated` → `resolved` → `closed`
- [ ] Timeline, remediation, and learnings fields
- [ ] Link incidents back to contradicted claims

**Falsifier completeness** (issue [#24](https://github.com/mesgme/rave-swamp/issues/24))
- [ ] `threshold` condition type (e.g. error rate > 5%)
- [ ] `regex` condition type (e.g. log pattern matching)
- [ ] `absence` condition type (evidence missing / not gathered within window)
- [ ] `staleness` condition type (evidence older than freshness window)
- [ ] `composite` condition type (boolean AND/OR over sub-conditions)

**Evidence freshness enforcement** (issue [#25](https://github.com/mesgme/rave-swamp/issues/25))
- [ ] Stale evidence (older than `freshness_window`) contributes 0.0 to confidence
- [ ] Evidence freshness factor applied per-evidence in confidence computation

**Scheduled automation** (issue [#26](https://github.com/mesgme/rave-swamp/issues/26))
- [ ] Cron-scheduled `gather-all-evidence` (e.g. hourly)
- [ ] Cron-scheduled `confidence-decay-sweep` (e.g. daily)
- [ ] Cron-scheduled `falsifier-sweep` (e.g. hourly)

**Scope aggregation** (issue [#27](https://github.com/mesgme/rave-swamp/issues/27))
- [ ] Readiness roll-up: a scope is ready when all claims within it have confidence ≥ threshold and none are contradicted
- [ ] Scope-level readiness queryable by AI agents

**Validation** (issue [#11](https://github.com/mesgme/rave-swamp/issues/11))
- [ ] End-to-end validation against spec examples

---

## Confidence Scoring

Confidence is dynamic — it is computed, not stored in YAML.

```
C(t) = C₀ × F_avg × Q_avg × e^(−λ × Δt)
```

| Variable | Meaning |
|---|---|
| `C₀` | Score at last revalidation |
| `F_avg` | Average freshness factor across linked evidence |
| `Q_avg` | Average quality score across linked evidence |
| `λ` | Decay rate (`decay_lambda` in claim YAML, default 0.05) |
| `Δt` | Days since last revalidation |

Confidence bands:
- **High** ≥ 0.80 — claim is well-evidenced and fresh
- **Medium** ≥ 0.50 — some staleness or evidence gaps
- **Low** ≥ 0.20 — significant decay or weak evidence
- **Critical** < 0.20 — claim is not meaningfully supported

A falsifier firing sets confidence to 0.0 immediately.

---

## Readiness

A scope is **ready** when:
- No active claims are `contradicted`
- All active claims have `confidence_score >= threshold` (default 0.70)

Readiness is the gate AI agents check before proceeding with deployments, releases, or other reliability-sensitive operations.

---

## Usage

See [USAGE.md](USAGE.md) for full operational instructions — creating claims, gathering evidence, computing confidence, evaluating falsifiers.

---

## Model Types

| Model type | Purpose |
|---|---|
| `rave/claim` | CRUD for claim YAML files |
| `rave/confidence-engine` | Compute and track confidence scores |
| `rave/ci-evidence` | Gather evidence from GitHub Actions |
| `rave/github-api-evidence` | Gather evidence from GitHub REST API |
| `rave/prometheus-evidence` | Gather evidence from Prometheus / Thanos |
| `rave/falsifier-engine` | Evaluate falsifier conditions |

---

## Spec

RAVE is defined by the [RAVE specification v0.1](https://github.com/mesgme/rave-spec/blob/main/spec/rave-spec-v0.1.md) in the sibling `rave-spec` repository.

# Production-Readiness Claim Catalog

A generic, reusable RAVE claim catalog derived from Susan Fowler's
*Production-Ready Microservices* (O'Reilly, 2016) plus a curated set of
post-2016 / AI-assisted-development additions. Every entry is a **claim sketch**
ready to be promoted into a concrete RAVE claim triple
(claim YAML + evidence YAML + falsifier YAML).

---

## How to use this catalog

Claims here are written **generically** — scope targets use `<service>` as a
placeholder so the catalog can be applied to any microservice at any customer
site. To instantiate a sketch for a real service, replace `<service>` with the
subject scope (e.g. `acme-corp/payments-api`) and wire the evidence URI to the
actual endpoint.

### Legend

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Sketch not yet promoted to a reusable claim template |
| `[x]`  | An analogous concrete claim already exists in rave-swamp (see ✅ note) |
| **✅ rave-swamp:** | The existing `claim-*-001` id(s) in `rave/claims/` that cover this entry |

### How to promote a sketch into a live claim

Follow the 10-step authoring flow documented in [`rave/README.md`](../rave/README.md):

1. Pick an id (`claim-<desc>-001`) and confirm or add its scope in `rave/scopes/<system>.yaml`.
2. Write `rave/claims/<id>.yaml` (v0.2.0 shape: `rave_version`, `claim_id`, `statement`, `owner`, `status`, `category`, `scope`, `assumptions`, `falsification_signals`, `confidence.decay_lambda`, `annotations`).
3. Write `rave/evidence/evidence-<desc>-001.yaml` (machine-referenceable `reference.uri`).
4. Write `rave/falsifiers/falsifier-<desc>-001.yaml` (condition type: `boolean` / `staleness` / `threshold`).
5. Create two engine model instances via `swamp model create`:
   - `confidence-engine` named `confidence-claim-<id>`
   - `falsifier-engine` named `<falsifier-id>`
6. Add a gather job to `gather-all-evidence` (skip for human-attested / out-of-band evidence).
7. Add an evaluate job to `falsifier-sweep`.
8. Add a compute job to `confidence-decay-sweep`.
9. Add a node entry to `readiness-check`.
10. Flip `status: active` and run `deno task check`.

---

## 1. Stability & Reliability (Fowler ch. 3)

*A stable, reliable service has a standardised development lifecycle, thoroughly
tested code, and a fully automated build and deployment pipeline.*

- [x] `claim-standard-dev-cycle-001` — **stability** — `<service>` follows a standardised development cycle: branch protection enabled, PRs required, reviews enforced, and CI must pass before merge.
  - **Evidence idea:** Repo branch-protection API (`GET /repos/{owner}/{repo}/branches/main/protection`) + CI workflow config.
  - **Falsifier idea:** boolean — protection enabled AND required reviews ≥ 1 AND CI check listed as required.
  - ✅ **rave-swamp:** `claim-branch-protection-001`, `claim-main-commits-via-pr-001`, `claim-merged-prs-reviewed-001`

- [x] `claim-code-thoroughly-tested-001` — **reliability** — `<service>` code passes lint, unit tests, integration tests, and end-to-end tests.
  - **Evidence idea:** CI run conclusions per test stage (GitHub Actions `runs` API filtered by workflow).
  - **Falsifier idea:** boolean — all required stage conclusions equal `success`.
  - ✅ **rave-swamp:** `claim-lint-clean-001`, `claim-unit-tests-pass-001`, `claim-code-coverage-001`

- [x] `claim-build-release-automated-001` — **stability** — Test, build, package, and release of `<service>` are fully automated with no manual steps required.
  - **Evidence idea:** CI/CD pipeline definition file presence + last release-workflow run result.
  - **Falsifier idea:** boolean — release pipeline run conclusion `success` within freshness window.
  - ✅ **rave-swamp (partial):** `claim-ci-green-on-main-001`

- [ ] `claim-staged-deploy-pipeline-001` — **deployment** — Deploys to production for `<service>` flow through at minimum staging → canary → production phases, gated between phases.
  - **Evidence idea:** Deploy pipeline config (Spinnaker / Argo Rollouts / deploy YAML) showing named stages.
  - **Falsifier idea:** boolean — all three phase names present in pipeline definition and ordered correctly.

- [ ] `claim-canary-gate-healthy-001` — **deployment** — The most recent production deploy of `<service>` passed its canary health gate before full rollout.
  - **Evidence idea:** Deployment / canary-analysis result (Argo Rollouts analysis run, or deploy-tool API).
  - **Falsifier idea:** boolean — latest canary analysis verdict == `pass`.

- [ ] `claim-clients-known-001` — **stability** — All upstream clients of `<service>` are catalogued and accessible to the service team.
  - **Evidence idea:** Service-graph API / API gateway consumer registry.
  - **Falsifier idea:** staleness — client inventory refreshed within window (e.g. `P30D`).

- [ ] `claim-dependencies-known-001` — **stability** — All downstream dependencies of `<service>` are catalogued (synchronous and asynchronous).
  - **Evidence idea:** Dependency manifest (`package.json`, lock file) + service-mesh topology / registry.
  - **Falsifier idea:** staleness — dependency inventory record fresh within window.

- [ ] `claim-dependency-fallbacks-001` — **fault_tolerance** — Each critical dependency of `<service>` has a defined fallback (cache, retry with backoff, circuit breaker, or graceful degradation).
  - **Evidence idea:** Resilience-config audit (e.g. Resilience4j config, policy-as-code output).
  - **Falsifier idea:** boolean — every critical dependency entry carries a declared fallback strategy.

- [ ] `claim-health-checks-present-001` — **reliability** — `<service>` exposes liveness and readiness health checks that are configured and honoured by the deployment platform.
  - **Evidence idea:** Orchestrator probe config (Kubernetes pod spec `livenessProbe` / `readinessProbe`) + last health-check result.
  - **Falsifier idea:** boolean — both probes are configured and last result is healthy.

- [ ] `claim-service-discovery-routed-001` — **reliability** — Traffic reaches `<service>` exclusively via service discovery or a stable virtual endpoint; no hardcoded IP/host references exist in clients.
  - **Evidence idea:** Service registry entry + mesh/gateway routing config audit.
  - **Falsifier idea:** boolean — service is registered and resolvable; no hardcoded host strings in client configs.

- [ ] `claim-deprecation-procedure-001` — **stability** — A documented deprecation and decommission procedure exists for `<service>` and has been reviewed recently.
  - **Evidence idea:** Runbook / ops doc presence check + `last_reviewed` metadata.
  - **Falsifier idea:** staleness — procedure doc reviewed within window (e.g. `P180D`).

---

## 2. Scalability & Performance (Fowler ch. 4)

*A scalable, performant service understands its growth trajectory, provisions
resources efficiently, and meets its latency and throughput targets.*

- [ ] `claim-growth-scales-known-001` — **scalability** — The qualitative and quantitative growth scales for `<service>` (what drives load and projected numbers) are documented.
  - **Evidence idea:** Capacity doc / planning artifact in the service wiki or repo.
  - **Falsifier idea:** staleness — growth model reviewed/updated within window (e.g. `P90D`).

- [ ] `claim-resource-bottlenecks-identified-001` — **performance** — CPU, memory, I/O, and network bottlenecks and per-instance resource requirements for `<service>` are identified and documented.
  - **Evidence idea:** Load-test or profiling report (JMeter, k6, pprof output).
  - **Falsifier idea:** staleness — profiling report generated within window.

- [ ] `claim-hardware-efficient-001` — **performance** — `<service>` uses its allocated hardware efficiently: utilisation sits within the target band (not over-provisioned or saturated).
  - **Evidence idea:** Prometheus utilisation query (e.g. `avg(rate(container_cpu_usage_seconds_total[5m]))`).
  - **Falsifier idea:** threshold — CPU/memory utilisation within `[low_bound, high_bound]` (e.g. 10%–80%).

- [ ] `claim-capacity-planning-scheduled-001` — **scalability** — Capacity planning for `<service>` runs automatically on a defined schedule.
  - **Evidence idea:** Scheduled-job run history (cron job / CI schedule) for the capacity-planning task.
  - **Falsifier idea:** staleness — last capacity-plan job run within the scheduled cadence.

- [ ] `claim-autoscaling-effective-001` — **scalability** — `<service>` scales horizontally or vertically with load without manual intervention.
  - **Evidence idea:** Autoscaler config (HPA / KEDA spec) + scaling-event history.
  - **Falsifier idea:** boolean — autoscaling is enabled; threshold — at least one scaling event occurred in the last quarter.

- [ ] `claim-dependencies-scale-001` — **scalability** — The dependencies of `<service>` can absorb its peak projected load, verified by test or contractual SLO.
  - **Evidence idea:** Dependency SLO/capacity attestation doc or load-test results against dependencies.
  - **Falsifier idea:** staleness — attestation present and reviewed within window.

- [ ] `claim-traffic-patterns-understood-001` — **performance** — Traffic patterns for `<service>` (daily/weekly peaks, burst characteristics) are characterised and documented.
  - **Evidence idea:** Traffic-analytics dashboard export (RPS over trailing 30 days).
  - **Falsifier idea:** staleness — traffic profile document refreshed within window.

- [ ] `claim-traffic-reroutable-001` — **fault_tolerance** — Traffic to `<service>` can be re-routed away from a failing region or instance without manual intervention.
  - **Evidence idea:** Failover routing config (DNS failover, load-balancer health policy) + last failover drill record.
  - **Falsifier idea:** boolean — failover routing is configured with automatic health-based switching.

- [ ] `claim-task-processing-scalable-001` — **scalability** — Asynchronous tasks and queues for `<service>` are processed in a scalable, backpressure-aware way.
  - **Evidence idea:** Queue-depth and consumer-lag metrics (Kafka lag, SQS `ApproximateNumberOfMessagesNotVisible`).
  - **Falsifier idea:** threshold — consumer lag below the defined bound.

- [ ] `claim-data-storage-scalable-001` — **scalability** — Data storage for `<service>` scales with growth (partitioning, sharding, or retention policies are in place).
  - **Evidence idea:** Datastore config + storage-growth metrics.
  - **Falsifier idea:** threshold — available storage headroom above the minimum bound.

- [ ] `claim-perf-slo-met-001` — **performance** — `<service>` meets its latency and throughput SLOs (e.g. p99 latency ≤ target) over the trailing measurement window.
  - **Evidence idea:** Prometheus SLI query (e.g. `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))`).
  - **Falsifier idea:** threshold — p99 ≤ target value; error rate ≤ target.

---

## 3. Fault Tolerance & Catastrophe-Preparedness (Fowler ch. 5)

*A fault-tolerant service runs without a single point of failure, understands its
failure modes, automates remediation, and has tested its ability to recover from
catastrophic events.*

- [ ] `claim-no-single-point-of-failure-001` — **fault_tolerance** — `<service>` runs with ≥ N redundant instances spread across ≥ 2 failure domains (availability zones or regions).
  - **Evidence idea:** Orchestrator replica/topology config (Kubernetes Deployment `replicas` + zone spread policy).
  - **Falsifier idea:** threshold — replica count ≥ N AND instances distributed across ≥ 2 zones.

- [ ] `claim-failure-scenarios-identified-001` — **catastrophe_preparedness** — Failure modes and catastrophe scenarios for `<service>` are documented in an FMEA or dependency-failure matrix.
  - **Evidence idea:** Failure-analysis doc presence + last-reviewed date.
  - **Falsifier idea:** staleness — analysis reviewed within window (e.g. `P180D`).

- [ ] `claim-resiliency-tested-001` — **fault_tolerance** — `<service>` is exercised by code tests, load tests, and chaos tests; all passed within the freshness window.
  - **Evidence idea:** Chaos/load test run results (Chaos Monkey, Gremlin, k6 run API).
  - **Falsifier idea:** boolean + staleness — all three test types ran within window AND results are `pass`.

- [ ] `claim-failure-remediation-automated-001` — **fault_tolerance** — Detection and remediation of common `<service>` failures is automated (auto-restart, auto-failover, circuit breaking).
  - **Evidence idea:** Alerting + automation rule audit (PagerDuty auto-action, Kubernetes liveness probe + restart policy).
  - **Falsifier idea:** boolean — auto-remediation rules are present and enabled for each identified failure mode.

- [ ] `claim-incident-response-procedure-001` — **catastrophe_preparedness** — A standardised incident and outage response procedure exists for `<service>` and has been reviewed recently.
  - **Evidence idea:** Incident-runbook doc + date of last incident retrospective.
  - **Falsifier idea:** staleness — procedure reviewed within window (e.g. `P90D`).

- [ ] `claim-backups-restorable-001` — **catastrophe_preparedness** — Backups of `<service>` data exist and a restore has been successfully tested within the freshness window.
  - **Evidence idea:** Backup-job run records + restore-drill result record.
  - **Falsifier idea:** staleness — last successful restore test within window (e.g. `P90D`).

---

## 4. Monitoring (Fowler ch. 6)

*A well-monitored service exposes key metrics, structured logs, and actionable
alerts, with runbooks and an on-call rotation to respond.*

- [ ] `claim-key-metrics-monitored-001` — **monitoring** — Host-level, infrastructure-level, and service-level key metrics for `<service>` are collected and queryable.
  - **Evidence idea:** Prometheus target list / metrics-endpoint scrape confirming required series are present.
  - **Falsifier idea:** boolean — all required metric series exist in the metrics store.

- [ ] `claim-logging-adequate-001` — **monitoring** — `<service>` emits structured logs sufficient to reconstruct its past state, error causes, and request paths.
  - **Evidence idea:** Log-pipeline health (Datadog / Loki / ELK ingest rate) + sample log schema validation.
  - **Falsifier idea:** boolean — log ingestion is healthy AND logs are structured (JSON schema present).

- [ ] `claim-dashboards-present-001` — **monitoring** — A dashboard covering all key metrics for `<service>` exists and is reachable.
  - **Evidence idea:** Grafana / Datadog dashboard API (dashboard existence + required panel list).
  - **Falsifier idea:** boolean — dashboard exists AND contains panels for all required key metrics.

- [ ] `claim-alerts-actionable-001` — **monitoring** — Alerts are defined for all key metrics with appropriate thresholds and each is linked to a runbook.
  - **Evidence idea:** Alert-rule export (Prometheus alertmanager rules / PagerDuty policy export).
  - **Falsifier idea:** boolean — each key metric has an alert rule with a non-empty `runbook_url` annotation.

- [ ] `claim-oncall-rotation-staffed-001` — **ownership** — A dedicated on-call rotation for `<service>` is staffed and has coverage for the current period.
  - **Evidence idea:** Paging-tool schedule API (PagerDuty / OpsGenie schedule endpoint).
  - **Falsifier idea:** staleness + boolean — rotation has at least one assigned responder for the current on-call window.

- [ ] `claim-oncall-runbooks-current-001` — **documentation** — Standardised on-call runbooks exist for `<service>` production incidents and have been reviewed recently.
  - **Evidence idea:** Runbook doc set in wiki/repo + last-reviewed metadata.
  - **Falsifier idea:** staleness — all runbooks reviewed within window (e.g. `P90D`).

---

## 5. Documentation & Understanding (Fowler ch. 7)

*A well-understood service has comprehensive, current documentation, a clear
owner, and has been formally assessed for production readiness.*

- [ ] `claim-docs-comprehensive-001` — **documentation** — `<service>` has comprehensive documentation covering: description and architecture, onboarding guide, API/endpoint spec, request flow, dependency list, FAQ, and links to dashboard and on-call schedule.
  - **Evidence idea:** Docs-repo presence checks per required section (check for specific headings / files).
  - **Falsifier idea:** boolean — all required sections are present in the documentation.

- [ ] `claim-docs-current-001` — **documentation** — `<service>` documentation has been reviewed or updated within the freshness window.
  - **Evidence idea:** Docs last-commit date / last-reviewed metadata in the doc frontmatter.
  - **Falsifier idea:** staleness — documentation updated within window (e.g. `P90D`).

- [ ] `claim-architecture-reviewed-001` — **governance** — The architecture of `<service>` is reviewed and audited on a recurring cadence.
  - **Evidence idea:** Architecture-review record (RFC / ADR with approved date).
  - **Falsifier idea:** staleness — most recent architecture review within cadence (e.g. `P365D`).

- [x] `claim-service-owner-current-001` — **ownership** — `<service>` has a current, identified owner or team with a reachable contact.
  - **Evidence idea:** Service-catalog owner field (PagerDuty service, Backstage catalog-info.yaml `owner`).
  - **Falsifier idea:** staleness — owner attested within window (e.g. `P90D`).
  - ✅ **rave-swamp:** `claim-service-owner-current-001`

- [ ] `claim-production-readiness-audited-001` — **governance** — A production-readiness review (PRR) has been completed for `<service>` and is current.
  - **Evidence idea:** PRR record presence + completion date (this catalog's roll-up, or a PRR doc).
  - **Falsifier idea:** staleness — PRR completed within window (e.g. `P365D`).

---

## 6. Modern / AI-assisted-dev additions

> The following claims extend Fowler's 2016 checklist to reflect current SRE
> practice, supply-chain security standards (SLSA, OpenSSF), and AI-assisted
> development workflows.

### Supply-chain security

- [x] `claim-no-secrets-committed-001` — **security** — No secrets or credentials are committed to the `<service>` repository.
  - **Evidence idea:** gitleaks / trufflehog CI scan result.
  - **Falsifier idea:** boolean — scanner exits 0 (no findings).
  - ✅ **rave-swamp:** `claim-no-secrets-committed-001`

- [x] `claim-no-known-cves-001` — **security** — No known-exploitable CVEs exist in the dependencies of `<service>`.
  - **Evidence idea:** Dependency vulnerability scan (npm audit, Dependabot, Trivy) CI result.
  - **Falsifier idea:** boolean — scanner reports zero critical/high findings.
  - ✅ **rave-swamp:** `claim-no-known-cves-001`

- [x] `claim-deps-pinned-001` — **supply_chain** — All dependencies (packages, container images, CI actions) are pinned to immutable versions or digests.
  - **Evidence idea:** Lock-file presence + SHA/digest pin audit in CI action configs.
  - **Falsifier idea:** boolean — lock file committed AND all action refs use full commit SHA.
  - ✅ **rave-swamp:** `claim-npm-imports-pinned-001`, `claim-actions-sha-pinned-001`, `claim-deno-lock-committed-001`

- [ ] `claim-sbom-published-001` — **supply_chain** — A current Software Bill of Materials (SBOM) is generated and published for each `<service>` release.
  - **Evidence idea:** Release artifact presence check for SBOM file (SPDX or CycloneDX format).
  - **Falsifier idea:** boolean + staleness — SBOM exists for the latest release AND was generated within the release window.

- [ ] `claim-build-provenance-signed-001` — **supply_chain** — Build artifacts for `<service>` carry cryptographically signed provenance (SLSA Build Level ≥ 2 / sigstore).
  - **Evidence idea:** Attestation verification (`cosign verify-attestation`, `slsa-verifier`).
  - **Falsifier idea:** boolean — provenance attestation verifies successfully for the latest release artifact.

### Observability

- [ ] `claim-distributed-tracing-001` — **observability** — `<service>` emits OpenTelemetry traces that are propagated across service boundaries and queryable in the tracing backend.
  - **Evidence idea:** Tracing-backend API (Jaeger / Tempo `services` endpoint) confirming the service name is present + a sample span showing propagated `traceId`.
  - **Falsifier idea:** boolean — service name present in tracing backend AND sampled spans carry a propagated trace context.

### SLOs & error budgets

- [ ] `claim-slo-error-budget-001` — **slo** — `<service>` has defined SLOs with an associated error budget, and the error budget is not exhausted.
  - **Evidence idea:** SLO/error-budget query (Prometheus recording rule, Google Cloud SLO API, Nobl9).
  - **Falsifier idea:** threshold — remaining error budget > 0% for all defined SLOs.
  - ✅ **rave-swamp (catalog-completeness only):** `claim-slo-catalog-complete-001`

### Progressive delivery & infrastructure

- [ ] `claim-progressive-delivery-001` — **deployment** — Releases for `<service>` use a progressive delivery strategy (feature flags, canary, or blue-green) with automated rollback on failure.
  - **Evidence idea:** Deploy-tool config (Argo Rollouts, Launch Darkly, Unleash) showing strategy and auto-rollback setting.
  - **Falsifier idea:** boolean — progressive strategy is configured AND automated rollback is enabled.

- [ ] `claim-infra-as-code-001` — **deployment** — All infrastructure for `<service>` is declared as code and no undeclared drift from the declared state exists.
  - **Evidence idea:** IaC drift-detection output (Terraform plan, Pulumi preview, AWS Config drift report).
  - **Falsifier idea:** boolean — drift detector reports zero resources out of declared state.

### AI-assisted development provenance

- [ ] `claim-ai-generated-code-reviewed-001` — **ai_provenance** — Every AI-assisted or agent-generated code change to `<service>` is human-reviewed and approved before merging (no unreviewed auto-merge of generated code).
  - **Evidence idea:** PR review records filtered to commits carrying the `Co-Authored-By: Claude` trailer (or equivalent AI-attribution marker); confirm each has ≥ 1 human approval.
  - **Falsifier idea:** boolean — all AI-attributed merged PRs in the trailing window have a human approval event.

- [ ] `claim-ai-change-attribution-001` — **ai_provenance** — All commits and PRs to `<service>` that were authored or substantially assisted by an AI tool carry a machine-readable attribution marker (trailer or label).
  - **Evidence idea:** Commit-trailer / PR-label audit — scan merged commits in trailing window for AI-authored ones without an attribution marker.
  - **Falsifier idea:** boolean — no AI-assisted merged changes lack attribution.

---

## Progress summary

| Section | Total | Done (`[x]`) | Remaining (`[ ]`) |
|---------|-------|--------------|-------------------|
| 1. Stability & Reliability | 11 | 3 | 8 |
| 2. Scalability & Performance | 11 | 0 | 11 |
| 3. Fault Tolerance & Catastrophe-Preparedness | 6 | 0 | 6 |
| 4. Monitoring | 6 | 0 | 6 |
| 5. Documentation & Understanding | 5 | 1 | 4 |
| 6. Modern / AI-era additions | 11 | 3 | 8 |
| **Total** | **50** | **7** | **43** |

---

## References

- Fowler, Susan J. *Production-Ready Microservices*. O'Reilly Media, 2016.
  ISBN 978-1491965979.
- RAVE claim schema and authoring conventions: [`rave/README.md`](../rave/README.md)
- 10-step claim authoring flow: see "How to promote a sketch" section above and
  [`rave/README.md`](../rave/README.md) §Authoring.
- SLSA framework: <https://slsa.dev>
- OpenSSF Scorecard: <https://securityscorecards.dev>
- OpenTelemetry: <https://opentelemetry.io>

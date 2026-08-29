# ADR 0047: Observability stack — Prometheus and Grafana

- Status: Accepted — implemented, live-verified (see Addendum)
- Date: 2026-08-28
- Extends: [ADR 0017](0017-logging-conventions.md)
- 한국어: [0047-observability-prometheus-grafana.ko.md](0047-observability-prometheus-grafana.ko.md)

## Context

[ROADMAP.md](../ROADMAP.md) §6 Stage 4's "Production DevOps stack introduction" component-status
table lists both Prometheus and Grafana as 🆕 (not started), each annotated "own ADR
(planned)". Prometheus is described there as "Metrics export layered on the Nest `Logger`
observability stance" — a direct reference to [ADR 0017](0017-logging-conventions.md), which
adopted Nest's built-in `Logger` as Stage 1's first observability increment and explicitly
deferred "structured logging and external error tracking… until a deploy environment exists
(Stage 4)". This ADR is that deferred increment.

Investigating the current gap: `HealthService`/`HealthController`
([ADR 0031](0031-health-and-readiness-endpoints.md)) provide only binary liveness/readiness
signals — they say "process up" and "DB reachable", nothing about request latency, throughput,
error rate, upload success/failure counts, or how close a resource is to exhaustion. `AllExceptionsFilter`'s
logging (ADR 0017) captures individual failures as they happen, but a log is a record of one
event, not a trend. `k8s/helm/values.yaml`'s `resources: {}` already documents that there is no
measured baseline to size CPU/memory limits from. None of `package.json`, `k8s/helm/`, or
`docker-compose.yml` reference any metrics library (`prom-client` or otherwise) — this starts
from zero.

`k8s/infra/terraform/addons/main.tf` ([ADR 0043](0043-terraform-project-adaptation.md)/
[ADR 0044](0044-terraform-three-state-split.md)) already calls the
`aws-ia/eks-blueprints-addons` Terraform module to install the AWS Load Balancer Controller and
External Secrets Operator. That same module also exposes an `enable_kube_prometheus_stack` flag,
not yet turned on.

## Decision

### D1 — App-level metrics library: `prom-client`, directly

Use `prom-client` directly, inside a new `MetricsModule` shaped the same way as the existing
operational modules — `HealthModule` ([ADR 0031](0031-health-and-readiness-endpoints.md)) and
`TempCleanupModule` ([ADR 0018](0018-orphan-temp-file-cleanup.md)): no domain module absorbs it,
and it is wired with direct dependency injection rather than a framework-specific wrapper.

Rejected alternatives:

- **`@willsoto/nestjs-prometheus`** — a second, decorator-based dependency wrapping
  `prom-client`. This project's existing operational modules already establish direct DI with a
  minimal dependency footprint as the house style, and the concrete need here — custom business
  counters (upload success/failure, orphan-cleanup sweep counts) rather than only generic HTTP
  histograms — is exactly the flexibility a decorator-wrapped library trades away for less
  boilerplate.
- **No app-level custom metrics, infra-only (kube-state-metrics / node-exporter / cAdvisor)** —
  zero code cost, but leaves no way to see upload success/failure rate, claim-replay frequency,
  or any other application-level signal; only pod-level CPU/memory and generic HTTP counters at
  the ingress. Rejected because it does not close the gap Stage 4 exists to close (Context).

`prom-client` is chosen because, of the three, it is the only option that lets this project
freely implement exactly the metrics its own operability calls for — matching Stage 4's stated
purpose more directly than a decorator-bound wrapper or an infra-only approach that cannot see
inside the app at all.

### D2 — Deployment: self-hosted via the existing `eks-blueprints-addons` module

Add `enable_kube_prometheus_stack = true` to the existing `module "eks_blueprints_addons"` call
in `k8s/infra/terraform/addons/main.tf` — the same module already providing the ALB Controller
([ADR 0043](0043-terraform-project-adaptation.md) D9) and External Secrets Operator
([ADR 0033](0033-secrets-delivery-target.md)/[ADR 0043](0043-terraform-project-adaptation.md)
D7). The flag installs the community `kube-prometheus-stack` Helm chart (Prometheus Operator,
Prometheus, Grafana, Alertmanager) as pods on this project's own EKS nodes.

Rejected: **Amazon Managed Prometheus (AMP) + Amazon Managed Grafana (AMG)**. Genuinely
AWS-managed — unlike the self-hosted option, the metrics data itself lives in an AWS backend,
mirroring the ESO→Secrets Manager pattern. But AMG requires AWS SSO / IAM Identity Center, an
authentication system this project has never needed, and metrics still need an in-cluster
collector (ADOT) to `remote_write` into AMP — so the managed path does not avoid installing
something in-cluster, it only adds AWS-service billing, a new IRSA role, and a new auth system on
top of the same in-cluster collection step the self-hosted option already requires. Rejected as
strictly more moving parts for this project's scale.

The app's own pods are scraped via a Prometheus Operator `ServiceMonitor` custom resource, added
as a new `k8s/helm/templates/servicemonitor.yaml` template — its target is the `/metrics`
endpoint from D1.

### D3 — One combined ADR, not two

ROADMAP.md's Stage 4 table lists Prometheus and Grafana as separate rows, each annotated "own
ADR (planned)"; this ADR supersedes that expectation with a single combined record.

`kube-prometheus-stack` (D2) already deploys both components as one Helm release — the decision
unit is one artifact, not two. Grafana also has no content to decide independently: its only
sanctioned datasource is Prometheus (ROADMAP's own framing — "dashboards/alerts over the
Prometheus datasource"), so a Grafana-only ADR would have nothing to say about scrape targets,
retention, or the collection mechanism until Prometheus is already decided.

### D4 — Verification scope

This task is verified against a real, re-provisioned AWS stack — the three Terraform states
(`cluster`/`app-infra`/`addons`) that were fully destroyed 2026-08-28 to stop the AWS bill
([ROADMAP.md](../ROADMAP.md) §9) are brought back up, and Prometheus scraping the app plus
Grafana rendering that data is confirmed live, not inferred from `terraform validate`/`fmt
-check` alone. Chosen deliberately by the developer, who accepted the AWS cost this re-incurs.

## Consequences

- New runtime dependency: `prom-client` (`dependencies`, not `devDependencies` — the
  `@nestjs/jwt` precedent, resolved 2026-07-22).
- New module: `MetricsModule`, exporting a `/metrics` endpoint. Its guard/auth stance is an
  implementation-time decision, deliberately left open here — but regardless of that answer, no
  metric label or value may carry PII/secrets (Never Do Group 3 still applies to this endpoint).
- Terraform: `k8s/infra/terraform/addons/main.tf`'s `module "eks_blueprints_addons"` gains one
  new flag; no new Terraform state and no new provider blocks beyond what that file already
  configures.
- Helm: a new `ServiceMonitor` template in `k8s/helm/templates/`. The chart itself still carries
  no scraping configuration of its own — `ServiceMonitor` is `kube-prometheus-stack`'s CRD,
  consumed here rather than built.
- Cost: no new AWS-managed-service billing line (unlike the rejected AMP/AMG path) — only the
  existing EKS node compute/storage footprint grows to host the added Prometheus/Grafana/
  Alertmanager pods.
- [ROADMAP.md](../ROADMAP.md)'s Production DevOps stack component-status table (§6, the
  Prometheus and Grafana rows) needs its status updated once implementation lands, matching how
  prior component rows were updated (e.g. Terraform's own row).
- Not yet done by this ADR: the `MetricsModule` code, the `ServiceMonitor` template, the
  Terraform flag itself, and the live re-provision + verification (D4) — this ADR records the
  decision; the follow-on implementation task carries it out.

### Addendum (2026-08-29) — `prom-client` kept for now; migration trigger recorded

`pnpm add prom-client` printed an npm deprecation warning during implementation. Investigated
directly rather than assumed: `github.com/siimon/prom-client` 301-redirects to
`github.com/prometheus/client_js`, and the maintainer's own GitHub Discussion
([prometheus/client_js#755](https://github.com/prometheus/client_js/discussions/755),
2026-07-01) confirms a genuine donation of the project to the Prometheus Project by its
original author (`siimon`) — not a fork or an unrelated package. The renamed package,
`@prometheus-io/client`, was first published as `0.16.0` on 2026-08-24, five days before this
addendum; the maintainer's own comments on that Discussion show the npm publish pipeline was
still being debugged as late as 2026-08-19.

Checked whether this changes D1's choice: `@prometheus-io/client`'s `0.16.0` CHANGELOG lists
its breaking changes against `prom-client` — dropped Node 16/18/20/21/23 support (moot; this
project pins Node ≥24, [ADR 0014](0014-node-pnpm-version-pinning.md)), an internal metric
storage refactor (moot; no subclassed metric types), Counter Exemplar value reporting (moot;
exemplars unused), and `MetricType` becoming a string union instead of a numeric enum (moot;
never referenced). None touch the `Registry`/`Counter`/`Histogram`/`collectDefaultMetrics`
surface `MetricsService` actually uses.

Checked real-world adoption before deciding: `prom-client` carried 9,206,303 weekly downloads
against `@prometheus-io/client`'s 7,157 (npm download-count API, 2026-08-29) — roughly 1300:1.
The NestJS ecosystem's Prometheus integrations (`@willsoto/nestjs-prometheus`,
`@miinded/nestjs-prometheus`, `nest-prom`) all still depend on `prom-client`, with no migration
found for any of them.

**Decision: keep `prom-client`.** D1 stands unchanged — only the package name was in question,
not the choice to depend on this underlying client at all.

**Migration trigger, recorded so this is not re-litigated from scratch later**: revisit once
either (a) `prom-client`'s npm listing carries an explicit end-of-support/security-patch cutoff
date, or (b) a NestJS Prometheus integration this project would actually consider (the D1
`@willsoto/nestjs-prometheus` precedent, or an equivalent) migrates its own dependency to
`@prometheus-io/client`. Either signals the new package has moved past the days-old state it
was in at this writing.

### Addendum (2026-08-29/30) — D4 live verification: blocked, then completed

Re-provisioning succeeded end to end: `cluster`/`app-infra`/`addons` all applied (ACM validated
once NS delegation was corrected), `kube-prometheus-stack` landed `deployed` with all pods
`Running`, and the app's Helm release (chart `sharenpo-0.3.0`, carrying this ADR's
`ServiceMonitor` template) also reached `deployed`. Prometheus picked up the target, but its
health was `down` with `lastError: "server returned HTTP status 404 Not Found"` — confirmed
directly (`GET /metrics` → `Cannot GET /metrics`).

Root cause was not in this ADR's own work: the running pod's image (`bluecode1775/sharenpo:
db-ssl-ca`, pinned in `values-prod.yaml`) was built before `MetricsModule` existed. This is the
known, previously-recorded gap at
[ROADMAP.md §7](../ROADMAP.md#7-unscheduled--open-decisions) ("`image.tag` … silently deploys
stale code") recurring in a variant that write-up hadn't covered — a *pinned* tag going stale
too, not just the `latest` default. Fixing that gap's root cause is out of this ADR's scope and
stays an open decision at ROADMAP §7 (three candidates, still awaiting the developer's pick);
unblocking D4 itself only needed a one-off manual image build + push + `values-prod.yaml` tag
bump, not a fix to that gap.

**D4 is now complete.** After rebuilding and pushing `bluecode1775/sharenpo:2cd73b9` (this ADR's
implementation commit) and re-running `helm upgrade`, verified directly:
- `GET /metrics` on the app pod → `200`, exposition body present (default process metrics +
  `http_request_duration_seconds` already populated from kubelet's own liveness/readiness
  probes, before any manual traffic).
- Prometheus: `up{job="upload-board"}` → `1` (target healthy); `temp_cleanup_deleted_total` →
  `0` (present immediately, as expected for an unlabeled counter with nothing yet to sweep);
  `sum(http_request_duration_seconds_count)` → `54` (nonzero, confirming real scrapes are
  landing, not just a reachable endpoint).
- Grafana: `GET /api/datasources` lists a working `Prometheus` datasource (plus
  `Alertmanager`), confirming `kube-prometheus-stack`'s auto-provisioning wired the dashboard
  layer to the same Prometheus instance without any manual configuration.

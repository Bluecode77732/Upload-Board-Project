# ADR 0037: Helm Chart — Scaffold Landed, Not Yet Project-Specific

- Status: Accepted (scaffold only — not deployable as-is)
- Date: 2026-08-11
- Related: [ADR 0038](0038-terraform-iac-scaffold.md) (same situation, Terraform side)
- 한국어: [0037-helm-chart-scaffold.ko.md](0037-helm-chart-scaffold.ko.md)

## Context

The Stage 4 "production DevOps stack introduction" row (ROADMAP.md §6) names Helm
as one of eight components, for release packaging/templating over the `k8s/`
manifests. Commit `ee75900` ("Adopt: Helm") added
`helm/upload-board-project/` — but landed with no CHANGELOG entry, no ROADMAP
component-status update, and no ADR, breaking the pattern every other Stage 4
component follows (Docker, health endpoints, migration-as-deploy-step, storage
port-adapter, and Kubernetes manifests each got one). This ADR closes that
documentation gap and records what the landed chart actually is.

Inspecting the chart directly: `Chart.yaml`'s `description` field reads "A Helm
chart for Kubernetes" — Helm's own boilerplate text from `helm create`, never
edited. `values.yaml`'s `image.repository` is `nginx` (tag `1.21`) — not this
project's own image (`bluecode1775/sharenpo`, published by the `docker-publish`
CI job added later in `1b72ec9`). `templates/` contains exactly one file,
`deployment.yml` — no Service, Ingress, or ConfigMap template, even though `k8s/`
already has hand-written raw manifests for a Service (`k8s/cluster/cluster_IP.yml`)
and a second Deployment (`k8s/deployment/deployment.yml`,
`k8s/deployment/rolling_update.yml`) that were never templated in. This is the
unmodified output of `helm create upload-board-project`, not a chart adapted to
this project.

## Decision

- **Record the scaffold as landed**, moving the Stage 4 component-status table's
  Helm row from 🆕 (not started) to a real, if minimal, base rather than leaving
  it undocumented.
- **Do not describe it as done or deployable.** It packages a placeholder `nginx`
  image and a single template — it cannot deploy this project's backend to a
  real cluster today.
- **Defer the adaptation pass** rather than rewriting the chart now: there is no
  live Kubernetes cluster or AWS account yet (Terraform, [ADR 0038](0038-terraform-iac-scaffold.md),
  is in the same unadapted state) and no way to validate a "real" chart's
  correctness against actual infrastructure before one exists.

## Alternatives rejected

- **Write the full production chart now** (Service/Ingress/ConfigMap templates,
  per-environment `values-{env}.yaml`, real image reference, secrets wiring) —
  rejected: nothing exists yet to deploy it against or validate it with, and
  [ADR 0033](0033-secrets-delivery-target.md)'s secrets-delivery shape is itself
  still design-only. Writing untestable infrastructure code now risks a rewrite
  once the cluster and secrets mechanism are real.
- **Delete the scaffold and start clean when the adaptation pass happens** —
  rejected: it costs nothing to keep, and it is a faster starting point
  (`helm create`'s structure, `.helmignore`, `Chart.yaml` fields already present)
  than an empty directory.

## Consequences

- ROADMAP.md's Stage 4 "Production DevOps stack — component status" table: Helm
  row moves from 🆕 to 🔶 (scaffold landed, project-specific adaptation pending).
- Follow-up (tracked in ROADMAP > Unscheduled, not scheduled as its own task
  yet): template the actual `k8s/` manifests (Service, second Deployment,
  rolling-update strategy) into `templates/`, point `values.yaml`'s
  `image.repository` at `bluecode1775/sharenpo`, and wire in the Kubernetes
  `Secret` consumption once [ADR 0033](0033-secrets-delivery-target.md) has code
  behind it. No new decision needed to start that work — this ADR is the record
  that it hasn't happened yet, not a design gate blocking it.
- No schema, entity, or API surface change. No code outside `helm/` touched by
  this ADR.

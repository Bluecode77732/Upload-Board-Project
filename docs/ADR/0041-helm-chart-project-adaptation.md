# ADR 0041: Helm Chart Project Adaptation — Lifting ADR 0037's Deferral

- Status: Accepted
- Date: 2026-08-17
- Amends: [ADR 0037](0037-helm-chart-scaffold.md) (lifts its "defer the adaptation
  pass" decision; ADR 0037's other two decision bullets — record the scaffold as
  landed, don't describe it as deployable — stay accurate and unchanged)
- Related: [ADR 0029](0029-storage-port-adapter.md) (the `STORAGE_DRIVER=local` /
  multi-replica gap this ADR's `replicaCount` default responds to),
  [ADR 0030](0030-container-non-root-and-arch-stance.md) (non-root uid 1001),
  [ADR 0031](0031-health-and-readiness-endpoints.md) (liveness/readiness routes),
  [ADR 0032](0032-migration-as-separate-deploy-step.md) (the migration Job this
  chart's Job template mirrors), [ADR 0033](0033-secrets-delivery-target.md) (the
  `Secret`/`envFrom` target this chart implements against),
  [ADR 0034](0034-https-termination-stance.md) (why Ingress stays disabled by
  default)
- 한국어: [0041-helm-chart-project-adaptation.ko.md](0041-helm-chart-project-adaptation.ko.md)

## Context

ADR 0037 recorded the Helm chart as an unmodified `helm create` scaffold and
deliberately deferred adapting it, on the grounds that no live Kubernetes cluster
or AWS account existed yet to validate a "real" chart against.

Two things have changed since:

1. **ADR 0037's own premise about `k8s/` turned out to be wrong.** It stated that
   `k8s/` already held hand-written, project-specific manifests (a Service, a
   second Deployment, a rolling-update strategy) that just hadn't been templated
   into Helm yet. Inspecting those five files directly showed they were
   themselves unmodified `nginx`/`nginx-app` placeholder examples — same class of
   scaffold as the Helm chart, not a real source to template from. This was
   corrected independently, ahead of this ADR, in commit `48a89f2`: `k8s/pod/pod.yml`,
   `k8s/deployment/deployment.yml`, `k8s/deployment/rolling_update.yml`,
   `k8s/cluster/deployment.yml`, and `k8s/cluster/cluster_IP.yml` now carry this
   project's own `app: upload-board-api` labels, the `bluecode1775/sharenpo:latest`
   image, and container port 3000 (matching the `Dockerfile`'s `EXPOSE 3000`).
2. **`helm lint --strict` and `helm template` need no live cluster.** They catch a
   real class of error — missing required values, malformed `Secret`/`ConfigMap`
   references, broken Go-template syntax — independent of `helm install` ever
   running against a real API server. ADR 0037's blocking condition ("nothing
   exists yet to validate a real chart's correctness against") only applies to
   that last step, not to writing and lint-checking the templates themselves.

## Decision

- **Lift ADR 0037's deferral.** Proceed with a project-specific adaptation of
  `helm/upload-board-project/` now, verified via `helm lint --strict` and
  `helm template` only. `helm install` against a live cluster remains
  unverified — this ADR narrows ADR 0037's gate, it does not remove it.
- **`k8s/` is not the template source.** Contrary to ADR 0037's context, `k8s/`
  never held real manifests to lift into `templates/`. The chart is instead
  derived from this project's actual source of truth: `Dockerfile` (image
  contract — port 3000, non-root uid 1001, `/health/live` `HEALTHCHECK`),
  `docker-compose.yml` (the one-shot `migrate` service shape, env wiring), and
  the Joi schema in `app.module.ts` (the full env var list, required vs.
  optional).
- **Chart contents added in this pass:**
  - `Chart.yaml` — real name/description/version, replacing the `helm create`
    boilerplate.
  - `Deployment` — image `bluecode1775/sharenpo`, `containerPort: 3000`,
    liveness probe on `/health/live` and readiness probe on `/health/ready`
    (ADR 0031), `securityContext.runAsUser: 1001` matching the Dockerfile's
    non-root user (ADR 0030).
  - `Service` — `ClusterIP`, port 3000.
  - `ConfigMap` — the non-secret env vars (`ENV`, `BASE_URL`, `CORS_ORIGIN`,
    `TEMP_SWEEP_*`, `STORAGE_DRIVER`, `AWS_REGION`, `CONTENT_SIGNED_URL_TTL_SECONDS`,
    etc.).
  - `Secret` consumption via `existingSecret` reference only — the chart never
    creates a `Secret` resource or accepts a secret value as a literal in
    `values.yaml`. An operator creates the `Secret` out-of-band
    (`kubectl create secret generic ...`) before `helm install`/`upgrade`, and
    the chart wires `envFrom.secretRef.name` to that name. This is the literal
    shape ADR 0033 already named as the target (`envFrom: secretRef`); it does
    not build the ESO/AWS Secrets Manager layer ADR 0033 deferred further.
  - Migration `Job` template mirroring `docker-compose.yml`'s one-shot `migrate`
    service (ADR 0032) — the chart's answer to that ADR's "K8s Job 🆕" remainder.
  - `Ingress` template kept, **disabled by default** (`ingress.enabled: false`).
    Enabling it for real still needs a live cluster, a DNS name, and a
    certificate mechanism (ACM or cert-manager) — none of which exist yet
    (ADR 0034 unchanged).
- **`replicaCount` default lowered from 3 to 1.** The chart's default
  `STORAGE_DRIVER` is `local` — each pod's `file/temp`/`file/upload` is that
  pod's own ephemeral disk, so a file uploaded through one replica is invisible
  to the others. This is the same multi-instance gap ADR 0029 already recorded
  for the storage layer; leaving the chart's own default at 3 would silently
  reintroduce it for anyone who runs `helm install` without first reading the
  storage ADR. `values.yaml` carries a comment stating `replicaCount` is safe to
  raise only once `STORAGE_DRIVER=s3`.
- **`httpRoute` (Gateway API) scaffold block left untouched, still disabled.**
  Istio — the component that would consume it — has no ADR yet and is
  explicitly planned after Terraform (ROADMAP.md); nothing about it changes in
  this pass.

## Alternatives rejected

- **Write a fully live-cluster-validated chart now** (i.e. also run
  `helm install` against a real cluster) — rejected for the same reason ADR 0037
  gave: no AWS account or cluster exists to install against, and ADR 0033's
  ESO/IRSA wiring is still design-only. This ADR narrows ADR 0037's blocking
  condition; it does not clear it entirely.
- **Have the chart create the `Secret` resource itself**, values supplied via
  `--set` or an untracked `values-secret.yaml` — rejected. Any code path that
  can hold a literal secret value, even one meant to stay untracked, is one
  accidental `git add -A` away from a leaked credential (Never Do Group 3).
  `existingSecret`-only keeps zero secret material inside the chart or any of
  its values files, and matches ADR 0033's target shape more literally than a
  chart-owned `Secret` would.
- **Keep the deferral in place until a live cluster exists** — rejected.
  `helm lint --strict`/`helm template` provide real, if partial, verification
  without a cluster; continuing to defer past that point produces no additional
  safety, only a longer stretch where the chart still cannot render at all.

## Consequences

- ROADMAP.md's Stage 4 component-status table: the Helm row's status symbol
  stays 🔶 (a live `helm install` is still unverified) but its description
  needs to move from "scaffold only" to "project-adapted, unverified against a
  live cluster" — tracked as a follow-up doc update alongside this ADR, not
  applied in this diff.
- The same table's Kubernetes row ("Base manifests landed under `k8s/`") is now
  literally accurate for the first time, as a side effect of the independent
  `k8s/` fix (commit `48a89f2`) this ADR's Context relies on — that row's wording
  also needs a follow-up pass to stop citing the old, inaccurate description.
- AWS Secrets Manager / External Secrets Operator / IRSA wiring stays exactly
  where ADR 0033 left it — deferred to the Terraform task. This ADR does not
  touch that boundary.
- `Ingress` stays disabled by default; enabling it for a real deployment still
  needs a live cluster, DNS, and a certificate mechanism — unchanged from
  ADR 0034.
- No schema, entity, or API surface change. No code outside `helm/` (and the
  already-independent `k8s/` fix) touched by this ADR.

### Addendum (2026-08-17) — `helm install` verified against a throwaway `kind` cluster

The "unverified beyond template rendering" line above no longer describes the
chart's plumbing. A local `kind` cluster (`kind create cluster`, torn down
afterward — not a persistent addition to this project's tooling) ran a full
`helm install --wait`: a throwaway `postgres:16`, a fresh image built from
current source (`bluecode1775/sharenpo:latest` on Docker Hub predates ADR
0039's SSL fix and connection-refuses against a non-TLS Postgres — unusable
for this, unrelated to the chart itself), the app Secret created out-of-band
per this chart's own README, and `/health/live`, `/health/ready`, and `/doc`
all answering `200` through the `Service`.

That run found two real bugs `helm lint`/`helm template` could not have
caught, both fixed in commit `0326199`:

1. **Hook ordering.** `migration-job.yml`'s `pre-install` hook read the
   ConfigMap via `envFrom`, but pre-install hooks run *before* any of the
   chart's normal (non-hook) resources — the ConfigMap didn't exist yet when
   the Job tried to start. Fixed by hooking the ConfigMap in too, at an
   earlier weight than the Job, with a `before-hook-creation` (not
   `hook-succeeded`) delete policy so it survives into the normal install
   phase for the Deployment/Service to read.
2. **Empty-string optional env vars.** `values.yaml`'s optional keys
   (`CORS_ORIGIN`, `SUPERADMIN_EMAIL`, `S3_BUCKET`, `AWS_REGION`) defaulted to
   `""`, which the ConfigMap rendered as a literal empty string — but
   `Joi.string()` (no `.allow('')`) in `backend/app.module.ts` rejects `""`
   even though the same var being *absent* is valid (the same contract
   `.env.example` expresses by commenting these out rather than setting them
   blank). The app crash-looped on `ConfigModule` validation. The ConfigMap
   template now omits empty-valued keys instead of emitting them.

**Still not verified**: a real target cluster (AWS/EKS). The `kind` run
proves the chart's own templates, hook ordering, and env wiring are correct —
it says nothing about infrastructure that doesn't exist yet (ROADMAP.md >
Stage 4). `kind`/the local image were both discarded after the run; nothing
from this addendum is a persisted addition to the repo or this machine beyond
the two bug fixes.

# ADR 0042: Consolidate `k8s/` and `helm/` — One Kubernetes Directory, Not Two

- Status: Accepted
- Date: 2026-08-17
- Related: [ADR 0037](0037-helm-chart-scaffold.md) (the Helm chart's original
  location, `helm/upload-board-project/`, moves here — 0037's historical
  Context is left as-is, describing where things stood on 2026-08-11),
  [ADR 0041](0041-helm-chart-project-adaptation.md) (the chart this ADR
  relocates; its path citations are updated for link hygiene, its Decision
  text is untouched)
- 한국어: [0042-k8s-helm-directory-consolidation.ko.md](0042-k8s-helm-directory-consolidation.ko.md)

## Context

The repo carried two top-level, sibling directories for Kubernetes-related
content: `k8s/` (raw manifests — `pod/pod.yml`, `deployment/deployment.yml`,
`deployment/rolling_update.yml`, `cluster/deployment.yml`,
`cluster/cluster_IP.yml`) and `helm/upload-board-project/` (the Helm chart,
project-adapted by ADR 0041).

ROADMAP.md's Stage 4 description names Helm's role as "release
packaging/templating **over the `k8s/` manifests**" — implying `k8s/` was
meant to be the source `helm/` templates from. ADR 0041's own Context already
established that relationship never existed in practice: the chart's
templates are derived from `Dockerfile`/`docker-compose.yml`/the Joi env
schema, not from `k8s/`. Checking what `k8s/`'s five files actually do today
confirms they are not wired into anything either — no CI job applies them, no
compose service references them, nothing in `.github/workflows/ci.yml`
touches `k8s/` or `helm/` at all. They were fixed to be project-specific
(`app: upload-board-api`, `bluecode1775/sharenpo:latest`, port 3000 — commit
`48a89f2`) as part of ADR 0041's work, but fixing their content didn't give
them a role: they remain static YAML that duplicates, in a strictly smaller
form, what the Helm chart's templates already render (a `Deployment` and a
`Service`, with no `ConfigMap`, `Secret` wiring, migration `Job`, or
`Ingress` equivalent).

Two directories claiming the same subject is exactly the shape that produced
ADR 0037's original documentation error — a claim about one directory's
content going stale because nothing forced the two to be checked together.

## Decision

- **`k8s/`'s five static manifest files are deleted**, not migrated forward.
  They represented a strict subset of what the Helm chart's templates already
  cover, and duplicating that subset in a second, non-templated form is a
  liability (silent drift) rather than a safety net.
- **The Helm chart moves from `helm/upload-board-project/` to
  `k8s/helm/upload-board-project/`.** This leaves exactly one top-level
  Kubernetes-related directory instead of two siblings. The chart's own
  files (`Chart.yaml`, `values.yaml`, `templates/*`, `README.md`+`.ko.md`,
  `.helmignore`) are otherwise unchanged in content — only internal path
  citations that pointed at the old location are updated: the two `required()`
  guard messages in `templates/deployment.yml`/`templates/migration-job.yml`,
  `templates/NOTES.txt`, a comment in `values.yaml`, and the relative
  `../../../docs/ADR/...` links in `README.md`/`README.ko.md` (now one
  directory level deeper).
- **ADR 0037 and ADR 0041's own bodies are not rewritten.** ADR 0037's
  Context describes what commit `ee75900` added on 2026-08-11 at
  `helm/upload-board-project/` — that was true then and stays as the
  historical record. ADR 0041's Decision and Addendum content is unchanged;
  only its literal path citations (e.g. links to the chart's README) are
  updated so they resolve, consistent with treating a path citation as a
  pointer to keep accurate rather than part of the recorded decision itself.

## Alternatives rejected

- **Keep both directories as-is** — rejected. `k8s/`'s files had no consumer
  and existed only as a second, unsynchronized description of the same
  Deployment/Service shape the Helm chart already renders — exactly the
  condition that let ADR 0037's factual error about `k8s/` go unnoticed for
  months.
- **Extract `helm template`'s rendered output into `k8s/` as the new static
  manifests** — rejected. This would flatten away everything ADR 0041 built:
  `values.yaml` parameterization, the `existingSecret` `required()` guard,
  and the pre-install hook ordering between the ConfigMap and the migration
  Job (found and fixed by the live smoke test, ADR 0041's 2026-08-17
  addendum). A static export is a functional downgrade, not a consolidation.
- **Move `k8s/`'s content into `helm/` instead** (i.e. keep `helm/` as the
  top-level name) — rejected as a naming call, not a functional one: `k8s/`
  is the more general, pre-existing name for "this repo's Kubernetes-related
  content," and nothing else currently competes for that top-level slot,
  whereas a future non-Helm Kubernetes artifact (e.g. a raw Job manifest for
  a one-off operational task) would have nowhere obvious to live under a
  `helm/`-named root.

## Consequences

- `helm/` no longer exists as a top-level directory. Any external reference,
  bookmark, or command assuming that path (e.g. `cd helm/upload-board-project`)
  needs updating to `k8s/helm/upload-board-project`.
- `docs/ROADMAP.md`'s Stage 4 component-status table (Kubernetes and Helm
  rows) and `docs/CHANGELOG.md` (a new `[Unreleased]` entry, not a rewrite of
  past entries) are updated to cite the new path — tracked as a follow-up doc
  update alongside this ADR.
- `k8s/infra/terraform/` is untouched — this ADR is scoped to the
  manifests/chart split, not the Terraform scaffold (ADR 0038).
- No schema, entity, or API surface change. `helm lint --strict` and
  `helm template` were re-run from the new path and pass identically to
  before the move.

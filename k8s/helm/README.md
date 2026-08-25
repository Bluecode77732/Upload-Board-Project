# sharenpo (Helm chart)

> 한국어: [README.ko.md](README.ko.md)

Packages this repo's backend (`Dockerfile`, `bluecode1775/sharenpo` on Docker
Hub) for Kubernetes. See [ADR 0042](../../docs/ADR/0042-k8s-helm-directory-consolidation.md)
for why this chart lives under `k8s/` rather than a sibling `helm/` directory,
[ADR 0041](../../docs/ADR/0041-helm-chart-project-adaptation.md) for why the
chart is shaped the way it is, and [ADR 0037](../../docs/ADR/0037-helm-chart-scaffold.md)
for its scaffold history.

**Status**: `helm install --wait` verified end-to-end against a throwaway local
`kind` cluster (2026-08-17) — a fresh image built from current source (not the
`bluecode1775/sharenpo:latest` Docker Hub tag, which predates ADR 0039's SSL
fix), a throwaway `postgres:16`, and `/health/live`/`/health/ready`/`/doc` all
answered `200` through the Service. That run found and fixed two real bugs
(hook ordering, empty-string env vars — commit `0326199`).
**Still unverified**: a real target cluster (AWS/EKS) — nothing has been
deployed there yet (ROADMAP.md > Stage 4). The `kind` run proves the chart's
own plumbing works, not that the target infrastructure exists.

## Before installing: create the Secret

This chart never creates a `Secret` resource and never accepts a secret value
as a `values.yaml` literal (ADR 0041, ADR 0033's target shape). Create one
yourself first:

```bash
kubectl create secret generic sharenpo-secrets \
  --from-literal=DB_USERNAME=<db-username> \
  --from-literal=DB_PASSWORD=<db-password> \
  --from-literal=ACCESS_TOKEN_SECRET=<random-string> \
  --from-literal=REFRESH_TOKEN_SECRET=<random-string>
```

To update a value later, rerun with `--dry-run=client -o yaml | kubectl apply -f -`.

Then point the chart at it:

```bash
helm install sharenpo . \
  --set secrets.existingSecret=sharenpo-secrets \
  --set env.DB_HOST=<postgres-host> \
  --set env.DB_DATABASE=<postgres-db> \
  --set env.BASE_URL=https://<your-host>
```

`secrets.existingSecret` is `required` — install fails fast with a clear error
if it's unset, rather than the pod crash-looping on a missing env var.

Object names come from the **release name** (`sharenpo` above), not from the
chart name — `_helpers.tpl`'s `fullname` helper is `.Release.Name`. Installing
under a different release name renames every object with it; only the
`app.kubernetes.io/name` label and `helm.sh/chart` follow `Chart.yaml`.

## What each template does

| Template | Kind | Notes |
|---|---|---|
| `deployment.yml` | Deployment | Image, port 3000, `/health/live`+`/health/ready` probes (ADR 0031), non-root `securityContext` (ADR 0030) |
| `service.yaml` | Service | `ClusterIP`, port 3000 |
| `configmap.yaml` | ConfigMap | Every key under `values.yaml`'s `env:` block |
| `migration-job.yml` | Job (Helm hook) | Runs `migration:run` pre-install/pre-upgrade, mirrors `docker-compose.yml`'s `migrate` service (ADR 0032) |
| `ingress.yaml` | Ingress | Disabled by default (`ingress.enabled: false`) — TLS terminates here, never in-process (ADR 0034) |

`values.yaml` carries only keys a template actually reads — the unused
`serviceAccount`/`autoscaling`/`httpRoute`/`nameOverride`/`fullnameOverride`
scaffold leftovers (never consumed by any template) were removed. Adding a
ServiceAccount, HPA, or Gateway API `HTTPRoute` in the future needs both a new
template and its `values.yaml` block added back together, not just the values.

## Env vars

Every key under `values.yaml`'s `env:` block must match the Joi schema in
`backend/app.module.ts` — the source of truth for which vars are required vs.
optional. `env`-block vars land in the ConfigMap; `DB_USERNAME`/`DB_PASSWORD`/
`ACCESS_TOKEN_SECRET`/`REFRESH_TOKEN_SECRET` come from `secrets.existingSecret`
instead, and are not repeated in `values.yaml`.

## Verifying without a cluster

```bash
helm lint --strict .
helm template . --set secrets.existingSecret=placeholder
```

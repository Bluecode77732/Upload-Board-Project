# upload-board-project (Helm chart)

> 한국어: [README.ko.md](README.ko.md)

Packages this repo's backend (`Dockerfile`, `bluecode1775/sharenpo` on Docker
Hub) for Kubernetes. See [ADR 0041](../../docs/ADR/0041-helm-chart-project-adaptation.md)
for why the chart is shaped the way it is, and [ADR 0037](../../docs/ADR/0037-helm-chart-scaffold.md)
for its scaffold history.

**Status**: templates render and pass `helm lint --strict` / `helm template`.
`helm install` has never been run against a live cluster — there isn't one yet
(ROADMAP.md > Stage 4). Treat this as unverified beyond template rendering.

## Before installing: create the Secret

This chart never creates a `Secret` resource and never accepts a secret value
as a `values.yaml` literal (ADR 0041, ADR 0033's target shape). Create one
yourself first:

```bash
kubectl create secret generic upload-board-secrets \
  --from-literal=DB_USERNAME=<db-username> \
  --from-literal=DB_PASSWORD=<db-password> \
  --from-literal=ACCESS_TOKEN_SECRET=<random-string> \
  --from-literal=REFRESH_TOKEN_SECRET=<random-string>
```

To update a value later, rerun with `--dry-run=client -o yaml | kubectl apply -f -`.

Then point the chart at it:

```bash
helm install upload-board . \
  --set secrets.existingSecret=upload-board-secrets \
  --set env.DB_HOST=<postgres-host> \
  --set env.DB_DATABASE=<postgres-db> \
  --set env.BASE_URL=https://<your-host>
```

`secrets.existingSecret` is `required` — install fails fast with a clear error
if it's unset, rather than the pod crash-looping on a missing env var.

## What each template does

| Template | Kind | Notes |
|---|---|---|
| `deployment.yml` | Deployment | Image, port 3000, `/health/live`+`/health/ready` probes (ADR 0031), non-root `securityContext` (ADR 0030) |
| `service.yaml` | Service | `ClusterIP`, port 3000 |
| `configmap.yaml` | ConfigMap | Every key under `values.yaml`'s `env:` block |
| `migration-job.yml` | Job (Helm hook) | Runs `migration:run` pre-install/pre-upgrade, mirrors `docker-compose.yml`'s `migrate` service (ADR 0032) |
| `ingress.yaml` | Ingress | Disabled by default (`ingress.enabled: false`) — TLS terminates here, never in-process (ADR 0034) |

`serviceAccount`, `autoscaling`, and `httpRoute` values exist in `values.yaml`
but nothing consumes them yet — see ADR 0041's Consequences.

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

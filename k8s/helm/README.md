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
**Deployed for real 2026-08-17 → stable 2026-08-27, torn down 2026-08-28**: the
release `upload-board` ran on the real AWS/EKS cluster from
`k8s/infra/terraform/cluster/` (revision 5, `STATUS: deployed`) — see
[ROADMAP.md](../../docs/ROADMAP.md) §9 (2026-08-27) for the full account,
including the `DB_SSL`/`DB_SSL_CA` fixes the RDS instance's `rds.force_ssl`
required (ADR 0039). It was reachable only inside the cluster the whole time
(`ingress.enabled: false` — never enabled). Once the deploy was proven
end-to-end, the underlying AWS infrastructure was fully destroyed to stop the
bill (ROADMAP.md §9, 2026-08-28) — **nothing currently runs**; this chart's
own contents are unaffected and `bash k8s/infra/terraform/deploy.sh all`
(ADR 0046) reproduces the same deployment from scratch.

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

For the real AWS deployment, `values-prod.yaml` collects the repeated
`--set env.X=Y` flags (added 2026-08-27, after the first live deployment
established which values those actually are — see ROADMAP.md §9):

```bash
helm upgrade upload-board . -f values-prod.yaml
```

It carries no secret values — `secrets.existingSecret` still just names the
Secret created above; the Secret itself is unaffected by this file.

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
| `serviceaccount.yaml` | ServiceAccount | Disabled by default (`serviceAccount.create: false` — Deployment runs as the namespace's `default` ServiceAccount, unchanged). Enable it to scope the S3 IRSA role to this app instead of every pod in the namespace — see "Dedicated ServiceAccount for IRSA" below |

`values.yaml` carries only keys a template actually reads — the unused
`autoscaling`/`httpRoute`/`nameOverride`/`fullnameOverride` scaffold leftovers
(never consumed by any template) were removed. `serviceAccount` was originally
in that same removed list; it got its own template back (mirroring
`ingress.yaml`'s disabled-by-default pattern) once a concrete need showed up —
see below. Adding an HPA or Gateway API `HTTPRoute` in the future still needs
both a new template and its `values.yaml` block added back together, not just
the values.

## Dedicated ServiceAccount for IRSA

`app-infra/`'s `aws_iam_role.app` IRSA role (S3 access under `STORAGE_DRIVER=s3`)
currently trusts `system:serviceaccount:default:default` — the manual
`kubectl annotate serviceaccount default ...` step in
`k8s/infra/terraform/README.md`'s "Known gap" section grants that role to
**every** pod in the namespace, not only this app's. `serviceAccount.create: true`
makes this chart render its own `ServiceAccount` and put it (not `default`) on
the Deployment. The name defaults to the release name; the decided target is
`sharenpo` (ROADMAP.md §7, "ServiceAccount name decided 2026-09-03:
`sharenpo`" — matching this file's own `helm install sharenpo .` convention
above, not the currently-live `upload-board` release), so no
`serviceAccount.name` override is needed once installed under that name:

```bash
helm upgrade sharenpo . \
  --reuse-values \
  --set serviceAccount.create=true \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$(terraform -chdir=../infra/terraform/app-infra output -raw app_iam_role_arn)
```

This closes only the chart half of the gap. `aws_iam_role.app`'s trust policy
is still hardcoded to `default:default` in Terraform (`app-infra/`) — enabling
`serviceAccount.create` without also updating that trust policy to trust
`sharenpo` leaves IRSA unable to authenticate (ROADMAP.md §7 tracks that
Terraform-side update as a separate, not-yet-started item). Updating the trust
policy is Terraform work, out of scope for this chart change — until it lands,
keep using the manual `default` annotation, or set `serviceAccount.name` to
`default` and skip `serviceAccount.create` entirely (no-op, since that's what
the chart already does by default). The migration
Job deliberately keeps running as `default` even when `serviceAccount.create`
is on — it only reads DB credentials from the Secret, never touches S3, so
giving it the app's IRSA identity would widen its permissions for no reason.

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

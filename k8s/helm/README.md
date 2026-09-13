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
established which values those actually are — see ROADMAP.md §9). The
release name is `sharenpo` (decided 2026-09-03, ROADMAP.md §7 — matching
`deploy.sh`'s `HELM_RELEASE` default, `values-prod.yaml`'s
`serviceAccount.create: true`, and `app-infra/main.tf`'s IRSA trust policy,
all four pinned to the same name; the live release deployed under the
earlier name was `upload-board`, see "Status" above). **Use `deploy.sh`, not
a bare `helm upgrade`**:

```bash
bash k8s/infra/terraform/deploy.sh helm
```

`values-prod.yaml` no longer pins a trustworthy `image.tag` on its own (2026-09-04,
[ROADMAP.md](../../docs/ROADMAP.md) §7) — `deploy.sh helm` resolves the branch's
current published image itself (`dev` by default, `deploy.sh helm main` for `main`)
and passes it as `--set image.tag=...` on top of this file. Running
`helm upgrade sharenpo . -f values-prod.yaml` directly skips that resolution and
silently deploys whatever tag happens to still be written in `values-prod.yaml`,
which is exactly the staleness bug that row exists to prevent — only reach for the
bare command below if you're deliberately pinning a specific image and supply
`--set image.tag=<tag>` yourself:

```bash
helm upgrade sharenpo . -f values-prod.yaml --set image.tag=<tag>
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
| `ingress.yaml` | Ingress | Disabled by default (`ingress.enabled: false`) — TLS terminates here, never in-process (ADR 0034). Path rules are an explicit allow-list of real controller prefixes, not a `/` catch-all — `/health`, `/metrics`, `/doc` are deliberately excluded (ADR 0058) |
| `serviceaccount.yaml` | ServiceAccount | Disabled by default (`serviceAccount.create: false` — Deployment runs as the namespace's `default` ServiceAccount, unchanged). Enable it to scope the S3 IRSA role to this app instead of every pod in the namespace — see "Dedicated ServiceAccount for IRSA" below |
| `networkpolicy.yaml` | NetworkPolicy | Disabled by default (`networkPolicy.enabled: false`) — restricts the app pod's inbound/outbound traffic. See "NetworkPolicy" below (ADR 0056) |

`values.yaml` carries only keys a template actually reads — the unused
`autoscaling`/`httpRoute`/`nameOverride`/`fullnameOverride` scaffold leftovers
(never consumed by any template) were removed. `serviceAccount` was originally
in that same removed list; it got its own template back (mirroring
`ingress.yaml`'s disabled-by-default pattern) once a concrete need showed up —
see below. Adding an HPA or Gateway API `HTTPRoute` in the future still needs
both a new template and its `values.yaml` block added back together, not just
the values.

## Dedicated ServiceAccount for IRSA

`app-infra/`'s `aws_iam_role.app` is the IRSA role that grants S3 access under
`STORAGE_DRIVER=s3` (ADR 0029, ADR 0043 D8). `serviceAccount.create: true`
makes this chart render its own `ServiceAccount` (`serviceaccount.yaml`) and
put it — not the namespace's `default` one — on the Deployment; without it,
every pod in the namespace using `default` would end up sharing whatever role
is annotated onto it, not just this app's pods.

`values-prod.yaml` already turns this on (`serviceAccount.create: true` +
the role's ARN in `annotations`, added 2026-09-03) — the real-deployment
command above needs nothing extra. The name resolves to the release name,
`sharenpo` (ROADMAP.md §7), which is also what `app-infra/main.tf`'s
`aws_iam_role.app` trust policy and `deploy.sh`'s `HELM_RELEASE` default both
point at — all three have to name-match for IRSA to actually authenticate.

Turning it on standalone, without `values-prod.yaml`, looks like:

```bash
helm upgrade sharenpo . \
  --reuse-values \
  --set serviceAccount.create=true \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$(terraform -chdir=../infra/terraform/app-infra output -raw app_iam_role_arn)
```

None of this has actually been applied against live AWS yet — see
`k8s/infra/terraform/README.md`'s "Known gap" for the current status and why
the old manual `kubectl annotate serviceaccount default ...` workaround no
longer works once `app-infra/`'s trust policy is applied. The migration Job
deliberately keeps running as `default` even when `serviceAccount.create` is
on — it only reads DB credentials from the Secret, never touches S3, so
giving it the app's IRSA identity would widen its permissions for no reason.

## NetworkPolicy

Restricts the app pod's traffic ([ADR 0056](../../docs/ADR/0056-networkpolicy-east-west-restriction.md)).
Disabled by default (`networkPolicy.enabled: false`) — not for the same reason
as `ingress.yaml`/`servicemonitor.yaml` (missing DNS/cert mechanism, missing
CRD), but because `k8s/infra/terraform/cluster/main.tf`'s `vpc-cni` addon
doesn't enable the VPC CNI Network Policy enforcement agent yet — turning
`networkPolicy.enabled` on today creates the resource but it isn't enforced
against the real cluster. `values-prod.yaml` already turns it on so it takes
effect the moment that Terraform-side enforcement is enabled, with no further
chart change.

Ingress is restricted to same-namespace pods only (blocks a pod in another
namespace from reaching this one directly); it does not attempt to carve out
an explicit allow for kubelet's health-check traffic, because on the VPC CNI a
pod IP and a node IP share the same address space — there's no `ipBlock` that
picks out "the node" and not "another pod." AWS's EKS docs say kubelet probes
are auto-exempted under the agent's "strict" mode, but a real counterexample
is filed upstream (`aws/amazon-vpc-cni-k8s#2571`), so **re-verify
`/health/live`/`/health/ready` still pass before ever relying on this against
a real cluster** — the recipe below only proves the policy's shape is correct
under Calico, a different enforcement engine than AWS's own agent.

Egress is the control that actually does something for this single-Deployment
app: default-deny, with explicit allows for DNS (CoreDNS), DB
(`networkPolicy.egress.vpcCidr:networkPolicy.egress.dbPort` — defaults to
`10.0.0.0/16:5432`, matching `cluster/main.tf`'s `var.vpc_cidr` default;
override if Terraform was applied with a different CIDR), and HTTPS on 443 to
any destination (S3/AWS API — there's no S3 VPC endpoint to scope this to a
CIDR, see the ADR).

### Verifying against a throwaway kind + Calico cluster

`kind`'s own CNI doesn't enforce `NetworkPolicy` — you need Calico:

```bash
kind create cluster --name netpol-verify --config - <<'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  disableDefaultCNI: true
  podSubnet: "192.168.0.0/16"
EOF
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.28.0/manifests/calico.yaml
# wait for the node and calico-node/calico-kube-controllers/coredns to be Ready, then:
docker build -t sharenpo-netpol-test:local -f Dockerfile .
kind load docker-image sharenpo-netpol-test:local --name netpol-verify
kubectl run postgres --image=postgres:16 --restart=Never \
  --env=POSTGRES_USER=sharenpo --env=POSTGRES_PASSWORD=sharenpo_pw --env=POSTGRES_DB=sharenpo \
  --port=5432 --overrides='{"apiVersion":"v1","metadata":{"labels":{"app":"postgres"}}}'
kubectl expose pod postgres --port=5432 --target-port=5432
kubectl create secret generic test-secrets \
  --from-literal=DB_USERNAME=sharenpo --from-literal=DB_PASSWORD=sharenpo_pw \
  --from-literal=ACCESS_TOKEN_SECRET=<32+ chars, mixed case+digit+symbol> \
  --from-literal=REFRESH_TOKEN_SECRET=<32+ chars, mixed case+digit+symbol>

helm install netpol-test . \
  --set image.repository=sharenpo-netpol-test --set image.tag=local --set image.pullPolicy=Never \
  --set secrets.existingSecret=test-secrets \
  --set env.DB_HOST=postgres --set env.DB_DATABASE=sharenpo --set env.BASE_URL=http://localhost:3000 \
  --set networkPolicy.enabled=true \
  --set networkPolicy.egress.vpcCidr=$(kubectl get pod postgres -o jsonpath='{.status.podIP}')/32 \
  --wait --timeout=180s
```

If this succeeds, kubelet's probes reached the pod despite the ingress rule —
the readiness probe checks DB connectivity too (ADR 0031), so a successful
`--wait` also proves the DNS + DB egress rules work and the migration Job's
pre-install hook completed. To confirm the restrictions are real, not a no-op:

```bash
# cross-namespace ingress must be blocked
kubectl create namespace other-ns
kubectl run curl-other -n other-ns --image=curlimages/curl:8.10.1 --restart=Never --rm -i --command -- \
  curl -sS -m 8 http://netpol-test.default.svc.cluster.local:3000/health/live
# expect: "Connection timed out"

# egress to an already-allowed host on a non-allowlisted port must be blocked
kubectl run curl-egress --image=curlimages/curl:8.10.1 --restart=Never --rm -i \
  --labels="app.kubernetes.io/name=sharenpo,app.kubernetes.io/instance=netpol-test" --command -- \
  curl -sS -m 8 telnet://$(kubectl get pod postgres -o jsonpath='{.status.podIP}'):9999
# expect: "Connection timed out"
```

Tear down when done: `helm uninstall netpol-test && kind delete cluster --name netpol-verify`.

**Troubleshooting**: re-running the `helm install` step after an interrupted or
failed prior attempt (without having torn down first) fails with `release name
check failed: cannot reuse a name that is still in use` — the old
`netpol-test` release is still registered. Fix: `helm uninstall netpol-test`
(check first with `helm list -A` if its status looks stuck, e.g.
`pending-install`), confirm it's gone, then retry `helm install`.

## Enabling HTTPS (Ingress)

TLS terminates at the Ingress/ALB, never in-process ([ADR 0034](../../docs/ADR/0034-https-termination-stance.md));
`values.yaml`'s `ingress` block ships an explicit controller-prefix allow-list, not a `/`
catch-all ([ADR 0058](../../docs/ADR/0058-ingress-path-allowlist.md)). `ingress.enabled`
stays `false` — a deliberate developer choice
([ROADMAP.md](../../docs/ROADMAP.md) > Unscheduled), not a missing dependency: while the
stack was live 2026-08-27 the cluster, the domain (`sharenpo.cloud`), and a real ACM cert
were all in place, and it was left off until an outside tester actually needs external
access. Re-confirmed 2026-09-13.

Two preconditions before it can do anything, both currently unmet (all three Terraform
states are destroyed):
- `addons/` applied — the AWS Load Balancer Controller has to be running in-cluster to
  reconcile an `Ingress` object at all.
- `app-infra/` applied — the ACM certificate for `domain_name` has to reach `ISSUED`
  (`terraform output -raw acm_certificate_arn`).

`values-prod.yaml` carries a fully commented-out `ingress:` block with the real host, the
ADR 0058 path list redeclared in full (Helm doesn't merge arrays across `-f` layers), and
the `certificate-arn`/`listen-ports`/`ssl-redirect` annotations for the HTTP→HTTPS force
redirect. Once both states above are applied, uncomment it, fill in the ARN, and flip
`enabled: true` — no `--set` flags needed at that point. For a one-off manual enable
without touching the checked-in file, `k8s/infra/terraform/README.md`'s "Enabling the ALB
ingress" section has the equivalent `helm upgrade --set ...` form.

Verifying without a live cluster (none exists right now):

```bash
helm lint --strict . --set secrets.existingSecret=placeholder --set ingress.enabled=true \
  --set ingress.className=alb \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=arn:aws:acm:ap-northeast-2:074416822640:certificate/placeholder \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/listen-ports"='[{"HTTP": 80}\, {"HTTPS": 443}]' \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/ssl-redirect"=443 \
  --set-json 'ingress.hosts=[{"host":"sharenpo.cloud","paths":[{"path":"/auth","pathType":"Prefix"},{"path":"/user","pathType":"Prefix"},{"path":"/post","pathType":"Prefix"},{"path":"/comment","pathType":"Prefix"},{"path":"/file","pathType":"Prefix"},{"path":"/upload","pathType":"Prefix"},{"path":"/audit-log","pathType":"Prefix"}]}]'
helm template . --set secrets.existingSecret=placeholder --set ingress.enabled=true \
  --set ingress.className=alb \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=arn:aws:acm:ap-northeast-2:074416822640:certificate/placeholder \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/listen-ports"='[{"HTTP": 80}\, {"HTTPS": 443}]' \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/ssl-redirect"=443 \
  --set-json 'ingress.hosts=[{"host":"sharenpo.cloud","paths":[{"path":"/auth","pathType":"Prefix"},{"path":"/user","pathType":"Prefix"},{"path":"/post","pathType":"Prefix"},{"path":"/comment","pathType":"Prefix"},{"path":"/file","pathType":"Prefix"},{"path":"/upload","pathType":"Prefix"},{"path":"/audit-log","pathType":"Prefix"}]}]' \
  -s templates/ingress.yaml
```

confirms the rendered `Ingress` carries `ingressClassName: alb`, the host, all seven
allow-listed paths, and the annotations (verified 2026-09-13 — an earlier draft of this
recipe used `--set ingress.hosts[0].host=...`, which replaces the whole array element and
silently drops every path; `--set-json` is what actually keeps them, per
`k8s/infra/terraform/README.md`'s "Enabling the ALB ingress" section, which hit and fixed
the same thing). A real `helm install --wait` against a live ALB Controller is out of scope
until Terraform is re-applied.

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

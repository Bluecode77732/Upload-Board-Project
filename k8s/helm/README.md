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
Re-verified 2026-09-24 on Docker Desktop's Kubernetes with the `frontend` and `admin`
workloads enabled (ADR 0062) — see "Verifying on Docker Desktop's Kubernetes" at the end of
this file.
**Deployed for real 2026-08-17 → stable 2026-08-27, torn down 2026-08-28 (re-applied
2026-08-29/30, torn down again 2026-08-31)**: the
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
| `ingress.yaml` | Ingress | Disabled by default (`ingress.enabled: false`) — TLS terminates here, never in-process (ADR 0034). Path rules are an explicit allow-list of real controller prefixes for the backend Service, plus one `/` rule (`service: frontend`) for the frontend Service and one `/admin` rule (`service: admin`) for the admin Service — `/health`, `/metrics`, `/doc` are deliberately not on the backend list and fall to the frontend's `/` (ADR 0058, ADR 0060, ADR 0062) |
| `serviceaccount.yaml` | ServiceAccount | Disabled by default (`serviceAccount.create: false` — Deployment runs as the namespace's `default` ServiceAccount, unchanged). Enable it to scope the S3 IRSA role to this app instead of every pod in the namespace — see "Dedicated ServiceAccount for IRSA" below |
| `networkpolicy.yaml` | NetworkPolicy | Disabled by default (`networkPolicy.enabled: false`) — restricts the app pod's inbound/outbound traffic. See "NetworkPolicy" below (ADR 0056) |
| `clamav-deployment.yaml` | Deployment | The `clamd` daemon `UploadService` scans uploads against — a single shared replica, not a per-app-pod sidecar (avoids duplicating the signature DB, ADR 0059 D6). Always renders, unlike `ingress`/`networkPolicy` |
| `clamav-service.yaml` | Service | `ClusterIP`, port 3310 — `configmap.yaml` computes `CLAMD_HOST` from this Service's name directly, not from `values.yaml`'s `env` map |
| `clamav-pvc.yaml` | PersistentVolumeClaim | Only renders when `clamav.persistence.enabled: true` (default `false` — signature DB re-downloads into an `emptyDir` on restart otherwise) |
| `frontend-deployment.yaml` | Deployment | The SPA's static-file nginx (`frontend/Dockerfile`) — a separate Pod from the app, with its own selector labels so the backend Service never selects it. Disabled by default (`frontend.enabled: false`); `values-prod.yaml` turns it on (ADR 0060) |
| `frontend-service.yaml` | Service | `ClusterIP`, port 80, named `web` rather than `http`: `servicemonitor.yaml` scrapes the port named `http` on every Service carrying `sharenpo.labels`, and nginx has no `/metrics`. The Ingress's `/` rule points here |
| `admin-deployment.yaml` | Deployment | The admin console's static-file nginx (`admin/Dockerfile`), serving under `/admin/` via `alias` — a separate Pod from the app and frontend, with its own selector labels. Disabled by default (`admin.enabled: false`); `values-prod.yaml` turns it on (ADR 0062) |
| `admin-service.yaml` | Service | `ClusterIP`, port 80, named `web` for the same Prometheus-scrape reason as `frontend-service.yaml`. The Ingress's `/admin` rule points here |

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

# clamav egress rule (ADR 0059 D6) must actually be open — use `nc -zv`, not
# `curl telnet://`; see the note right below for why
kubectl run curl-clamav --image=busybox:1.36 --restart=Never --rm -i \
  --labels="app.kubernetes.io/name=sharenpo,app.kubernetes.io/instance=netpol-test" --command -- \
  timeout 5 nc -zv netpol-test-clamav 3310
# expect: "... 3310 (...) open"
```

**Don't use `curl telnet://host:port` to probe the `clamav` connection** — this
was tried first (2026-09-15) and reported `curl: (28) Time-out` for a
connection that `nc -zv` then confirmed was actually open. `clamd` never sends
anything until the client speaks first, so curl's telnet mode just sits
waiting for a response that never comes, indistinguishable in curl's own
output from a genuinely blocked connection. `nc -zv` (TCP handshake only, no
protocol assumptions) is the right tool for any raw-protocol port like this.

Tear down when done: `helm uninstall netpol-test && kind delete cluster --name netpol-verify`.

**Troubleshooting**:
- Re-running the `helm install` step after an interrupted or failed prior
  attempt (without having torn down first) fails with `release name check
  failed: cannot reuse a name that is still in use` — the old `netpol-test`
  release is still registered. Fix: `helm uninstall netpol-test` (check first
  with `helm list -A` if its status looks stuck, e.g. `pending-install`),
  confirm it's gone, then retry `helm install`.
- On Git Bash (Windows), don't inline `$(kubectl get pod ... -o
  jsonpath='{.status.podIP}')` directly into a `--set ...=$(...)/32` argument.
  If the pod has no IP yet, the substitution silently becomes empty and the
  leading `/32` gets mangled by MSYS2's path conversion into something like
  `C:/Program Files/Git/32`, which then fails Kubernetes' CIDR validation with
  a confusing error. Capture it into a variable and print it first:
  `PG_IP=$(kubectl get pod postgres -o jsonpath='{.status.podIP}'); echo
  "PG_IP=$PG_IP"` — confirm it's a real IP before using it.

## Enabling HTTPS (Ingress)

TLS terminates at the Ingress/ALB, never in-process ([ADR 0034](../../docs/ADR/0034-https-termination-stance.md));
`values.yaml`'s `ingress` block ships an explicit controller-prefix allow-list, not a `/`
catch-all on the backend Service ([ADR 0058](../../docs/ADR/0058-ingress-path-allowlist.md)), plus one `/`
rule for the frontend Service ([ADR 0060](../../docs/ADR/0060-frontend-same-alb-path-routing.md)) and
one `/admin` rule for the admin Service ([ADR 0062](../../docs/ADR/0062-admin-same-alb-subpath-routing.md)). `ingress.enabled`
stays `false` — a deliberate developer choice
([ROADMAP.md](../../docs/ROADMAP.md) > Unscheduled), not a missing dependency: while the
stack was live 2026-08-27 the cluster, the domain (`sharenpo.cloud`), and a real ACM cert
were all in place, and it was left off until an outside tester actually needs external
access. Re-confirmed 2026-09-13.

Two preconditions before it can do anything, both currently unmet (all three Terraform
states are destroyed):
- `addons/` applied — the AWS Load Balancer Controller has to be running in-cluster to
  reconcile an `Ingress` object at all. The same state installs ExternalDNS, which creates
  the domain's DNS record for the ALB ([ADR 0063](../../docs/ADR/0063-alb-dns-externaldns-and-delegation-set.md)).
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
  --set ingress.className=alb --set frontend.enabled=true --set admin.enabled=true \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=arn:aws:acm:ap-northeast-2:074416822640:certificate/placeholder \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/target-type"=ip \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/listen-ports"='[{"HTTP": 80}\, {"HTTPS": 443}]' \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/ssl-redirect"=443 \
  --set-json 'ingress.hosts=[{"host":"sharenpo.cloud","paths":[{"path":"/auth","pathType":"Prefix"},{"path":"/user","pathType":"Prefix"},{"path":"/post","pathType":"Prefix"},{"path":"/comment","pathType":"Prefix"},{"path":"/file","pathType":"Prefix"},{"path":"/upload","pathType":"Prefix"},{"path":"/audit-log","pathType":"Prefix"},{"path":"/","pathType":"Prefix","service":"frontend"},{"path":"/admin","pathType":"Prefix","service":"admin"}]}]'
helm template . --set secrets.existingSecret=placeholder --set ingress.enabled=true \
  --set ingress.className=alb --set frontend.enabled=true --set admin.enabled=true \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=arn:aws:acm:ap-northeast-2:074416822640:certificate/placeholder \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/target-type"=ip \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/listen-ports"='[{"HTTP": 80}\, {"HTTPS": 443}]' \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/ssl-redirect"=443 \
  --set-json 'ingress.hosts=[{"host":"sharenpo.cloud","paths":[{"path":"/auth","pathType":"Prefix"},{"path":"/user","pathType":"Prefix"},{"path":"/post","pathType":"Prefix"},{"path":"/comment","pathType":"Prefix"},{"path":"/file","pathType":"Prefix"},{"path":"/upload","pathType":"Prefix"},{"path":"/audit-log","pathType":"Prefix"},{"path":"/","pathType":"Prefix","service":"frontend"},{"path":"/admin","pathType":"Prefix","service":"admin"}]}]' \
  -s templates/ingress.yaml
```

The same flags also render `networkpolicy.yaml`'s ALB ingress-allow rule (ADR 0056
addendum) — add `--set networkPolicy.enabled=true -s templates/networkpolicy.yaml` to
see both rules (`podSelector: {}` and the new `ipBlock`) at once.

confirms the rendered `Ingress` carries `ingressClassName: alb`, the host, all seven
allow-listed backend paths plus the `/` frontend rule (2026-09-21) and the `/admin` admin
rule (2026-09-23), and the annotations (verified 2026-09-13 — an earlier draft of this
recipe used `--set ingress.hosts[0].host=...`, which replaces the whole array element and
silently drops every path; `--set-json` is what actually keeps them, per
`k8s/infra/terraform/README.md`'s "Enabling the ALB ingress" section, which hit and fixed
the same thing). A real `helm install --wait` against a live ALB Controller is out of scope
until Terraform is re-applied.

**Pending — required before trusting this in production, not yet done because no live
ALB Controller exists to test against:** rendering correctly is not the same as the ALB
actually behaving as configured. Once `addons/`+`app-infra/` are re-applied,
`ingress.enabled` is actually flipped on, and ExternalDNS has made the domain resolve to the
ALB (ADR 0063), verify explicitly rather than assuming the annotations worked:
- `aws route53 list-resource-record-sets` for the zone shows an alias `A` record for the domain
  pointing at the ALB plus ExternalDNS's `TXT` ownership records within a few minutes of the
  `Ingress` appearing, and they are gone after it is removed (or the zone's `force_destroy`
  clears them). The command is in `k8s/infra/terraform/README.md` > "Enabling the ALB
  ingress". Never observed live (ADR 0063).
- Before the first deploy, on your machine (no cluster needed): `values-prod.yaml` runs ClamAV
  as `clamav/clamav:stable-debian`, not the `stable` tag the chart was verified with — `stable`
  lists `linux/amd64` alone on Docker Hub and the only nodes that run are `arm64`, while
  `stable-debian` lists amd64, arm64 and ppc64le (read 2026-09-25;
  [ADR 0059](../../docs/ADR/0059-upload-malware-scanning-clamav.md) Addendum). The developer ran it
  locally on 2026-09-26 and reported that every output matched the expected values (the session
  did not see them; which platforms were run, the time to Ready and clamd's memory were not
  reported). It covers the two things the chart assumes: `clamdcheck.sh` exists (both probes call it) and
  `/var/lib/clamav` is the signature directory. If either is missing, the clamd pod never
  becomes Ready and every upload answers `503 UPLOAD_SCAN_UNAVAILABLE`. Run it once with
  `--platform linux/arm64` too: Docker Desktop's platform list includes `linux/arm64` (emulated,
  so slow, and not Graviton hardware; not run here). What only shows up live: the `clamav`
  Deployment Ready on a Graviton node, an EICAR upload answering `400 UPLOAD_MALWARE_DETECTED`,
  a clean file passing.
- `aws elbv2 describe-listeners` on the created ALB shows both a port-80 and a port-443
  listener (`listen-ports` actually took effect, not just rendered).
- `curl -I http://<domain>` returns a `301`/`302` to the `https://` URL (`ssl-redirect`
  actually fires).
- A browser accepts the certificate with no warnings for the same domain the ACM
  certificate was issued for (the `certificate-arn` annotation actually bound the right
  cert).
- `curl https://<domain>/file` with no token answers the API's 401 JSON, not HTML, while
  `/files`, `/posts/1`, and an unknown path answer the SPA's HTML — the `/` frontend rule
  really sits below the API prefixes (ADR 0060; the controller's Exact-then-longest-Prefix
  ordering has never been observed live). `/health/live`, `/metrics`, and `/doc` must also
  answer the SPA's HTML (or 404), never a backend response.
- `curl https://<domain>/admin/` returns the admin console's HTML (not the frontend's, and
  not a 404) — confirms `/admin` sits in the rule set at all and Exact-then-longest-Prefix
  ordering doesn't let a shorter rule swallow it first (ADR 0062, also never observed live).
  A bare `curl -I https://<domain>/admin` (no trailing slash) returns nginx's own `301` to
  `/admin/`, not the ALB's — confirms the request actually reached the admin pod rather than
  being rewritten or dropped upstream.
- The target group registers healthy targets. `values-prod.yaml`'s commented annotation
  block now sets `alb.ingress.kubernetes.io/target-type: ip` (added 2026-09-22 — the
  controller's `instance` default needs a `NodePort`/`LoadBalancer` Service, and both
  Services in this chart are `ClusterIP`); this only fixes the rendered annotation, not
  whether the real ALB actually registers the pods as healthy.
- With `networkPolicy.enabled: true` (what `values-prod.yaml` sets) and Ingress on,
  `networkpolicy.yaml` renders a second ingress rule admitting the VPC CIDR on the app's
  port (ADR 0056 addendum, added alongside the `target-type` fix above — the ALB's ENIs
  aren't pods, so the existing same-namespace-only rule never let them through). Confirm
  the ALB's target group is healthy (the same check as the bullet above) and, per ADR
  0056 D2's standing caveat, that this is enforced by AWS's own VPC CNI Network Policy
  agent and not just rendered — `kind`+Calico cannot simulate a real VPC CIDR, so this
  rule has no non-live way to verify beyond `helm template`.
- Once the VPC CNI Network Policy agent is on (set in `cluster/main.tf` on 2026-09-26, code-complete and never
  applied — [ADR 0056](../../docs/ADR/0056-networkpolicy-east-west-restriction.md)
  Addendum), also confirm enforcement is real and nothing legitimate is blocked: `aws-node`
  pods show two containers and the VPC CNI version is `v1.14.0-eksbuild.3` or later; app pods
  become Ready with `/health/live` and `/health/ready` passing (kubelet probes not blocked,
  `aws/amazon-vpc-cni-k8s#2571`); with Ingress off a pod in another namespace cannot reach the
  app pod (with Ingress on the VPC-CIDR rule admits it, so no timeout is expected there) and a
  non-allow-listed egress port times out; DNS, the database (5432), clamd (3310) and HTTPS/443
  (S3) work, an EICAR upload is refused and a clean file passes; Prometheus still scrapes the
  backend (the ingress rule admits same-namespace pods, plus the VPC CIDR only when Ingress is
  on — so with Ingress off the scrape may be blocked; an inference, not observed);
  ExternalDNS, External Secrets and the ALB Controller are unaffected.
- Sign in over the real HTTPS connection, then reload the page: the session survives. The
  refresh cookie must arrive as `HttpOnly; Secure; SameSite=Strict; Path=/auth/token` and go
  back on `POST /auth/token/refresh` — a `Secure` cookie only works when the browser's
  connection is HTTPS, so this can't be seen anywhere else (ADR 0012, ADR 0034).
- With `STORAGE_DRIVER=s3` (what `values-prod.yaml` sets): a private file's preview (blob
  `fetch()` → the API's 302 → a presigned S3 URL) and a public/unlisted `<img>`/`<video>` all
  load with no CSP or CORS error in the browser console. Two things must already be true: the
  bucket has a CORS rule for the production origin. `app-infra/main.tf` now declares one
  (`aws_s3_bucket_cors_configuration.app`, added 2026-09-22, ADR 0036 addendum) —
  code-complete but not yet applied, and applying it **replaces** the rule currently on
  the bucket (the 2026-08-16 hand-run script's two localhost dev origins only, no
  production entry) with the production origin only; re-add the dev origins by hand
  again if local `STORAGE_DRIVER=s3` testing against the real bucket is still wanted
  after that apply. Separately, `frontend/nginx.conf`'s CSP must allow
  `https://*.amazonaws.com` (ADR 0060 — a guess from CSP semantics until seen in a
  browser).
- The real client IP reaches the rate limiter (`trust proxy` = `10.0.0.0/16`, ADR 0054
  addendum): from one client the sixth `POST /auth/signin` within a minute answers 429, while
  a second client on another IP is not throttled at all. If every visitor shares one bucket,
  the peer the app sees is not inside that CIDR.
- Rollout and scraping: `kubectl rollout status` succeeds for all three Deployments, the
  frontend and admin Services each have a ready endpoint and the backend Service has none of
  their pods, and Prometheus lists a target for the backend but none for frontend or admin
  (the `web` port name, ADR 0060, ADR 0062).
- Pods stop promptly on EKS (ADR 0061). With `values-prod.yaml` (so `STORAGE_DRIVER=s3`), run
  `kubectl rollout restart deployment/<release>` and watch `kubectl get pods -w`: each old
  backend pod should leave `Terminating` within a second or two. One that sits there for the
  full 30 s (the chart sets no `terminationGracePeriodSeconds`, so the default applies) was
  SIGKILLed — something kept the process from exiting even with `useProcessExit: true`, so look
  for a shutdown path that never reaches the hooks. Measured on a local `kind` cluster only:
  0.4 s, against 30.6 s without the option when a timer was left running. `S3Client` specifically
  is a closed question already — a Docker-only test standing in for its default `keepAlive`
  request agent (same handle shape, ADR 0061's second addendum) exited just as fast with the
  socket left open on purpose — so this check is really about there being nothing else specific
  to a live pod, not that handle.
- No ALB errors during a rolling update (ADR 0061) — the check most likely to fail. Before
  the fix a pod ignored SIGTERM and kept running until SIGKILL, which (inference, not
  measured) outlasted the ALB's deregistration lag by accident; now it exits within a second,
  so a request the ALB routes to it after SIGTERM but before the target drains can be refused.
  While `kubectl rollout restart deployment/<release>` runs, send about one request a second
  from outside to an allow-listed route — `curl -s -o /dev/null -w '%{http_code}\n'
  https://<domain>/file` answers 401 with no token — and count `502`/`503`/`504`. `401` and
  `429` are the backend answering (429 is its own rate limit, so stay under 100 a minute).
  Pass: none of the three. If they appear, add a `preStop` sleep on the app container and raise
  `terminationGracePeriodSeconds` to at least cover it. That *mechanism* is verified on a
  throwaway `kind` deployment (not committed to the chart, ADR 0061's second addendum): with
  grace covering the sleep, the pod left in 5.7 s as expected; with grace deliberately shorter
  than the sleep, kubelet still sent SIGTERM the moment it gave up on the stuck hook, and the
  app exited cleanly — the pod just took the full grace period (36.4 s) instead. So an
  under-sized grace period here costs rollout time, not a raw SIGKILL of the app — on this
  `kind`/containerd version, at least; not verified on EKS. None of this says what the sleep
  duration should actually be — that needs the real ALB's drain-lag number, still unmeasured, so
  the chart has neither setting today and it's still not decided.

None of this can be verified by `helm lint`/`helm template` — they only prove the YAML
this repo renders is correct, never that the AWS Load Balancer Controller acts on it as
documented.

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

The frontend workload (ADR 0060) renders only with `--set frontend.enabled=true`, and the `/`
rule appears in the Ingress only then:

```bash
helm template . --set secrets.existingSecret=placeholder --set frontend.enabled=true \
  --set ingress.enabled=true \
  -s templates/ingress.yaml -s templates/frontend-deployment.yaml -s templates/frontend-service.yaml
```

The image needs no cluster either — build it and check the SPA fallback and the headers:

```bash
docker build -t sharenpo-frontend:local -f ../../frontend/Dockerfile ../../frontend
docker run --rm -p 8080:8080 sharenpo-frontend:local
# /  and  /posts/1 → 200 index.html;  /assets/missing.js → 404;  CSP + nosniff headers on every response
```

The admin workload (ADR 0062) renders only with `--set admin.enabled=true`, and the `/admin`
rule appears in the Ingress only then:

```bash
helm template . --set secrets.existingSecret=placeholder --set admin.enabled=true \
  --set ingress.enabled=true \
  -s templates/ingress.yaml -s templates/admin-deployment.yaml -s templates/admin-service.yaml
```

Same for its image — served under `/admin/` (`alias`, not `root`, ADR 0062 D5), so the checks
are against that prefix instead of root:

```bash
docker build -t sharenpo-admin:local -f ../../admin/Dockerfile ../../admin
docker run --rm -p 8080:8080 sharenpo-admin:local
# /admin (no slash) → 301 to /admin/;  /admin/  and  /admin/dashboard → 200 index.html;
# /admin/assets/missing.js → 404;  /  (outside /admin) → 404;  CSP + nosniff headers on every response
```

## Verifying on Docker Desktop's Kubernetes

Verified 2026-09-24 (ADR 0062) with `frontend` and `admin` enabled and Ingress and NetworkPolicy
off — Docker Desktop has no ALB Controller, and its default CNI doesn't enforce `NetworkPolicy`.
Every command pins `--context docker-desktop` / `--kube-context docker-desktop` because a real EKS
context can sit in the same kubeconfig. Git Bash, from the repo root unless a `cd` says otherwise.

```bash
# 1. Throwaway namespace, a Postgres standing in for RDS, and a Secret (the public dummy values CI already commits)
kubectl --context docker-desktop create namespace c13-verify
kubectl --context docker-desktop -n c13-verify run postgres --image=postgres:16 --image-pull-policy=IfNotPresent --restart=Never --env=POSTGRES_USER=sharenpo --env=POSTGRES_PASSWORD=sharenpo_pw --env=POSTGRES_DB=sharenpo --port=5432 --labels=app=postgres
kubectl --context docker-desktop -n c13-verify expose pod postgres --port=5432 --target-port=5432
kubectl --context docker-desktop -n c13-verify create secret generic c13-secrets --from-literal=DB_USERNAME=sharenpo --from-literal=DB_PASSWORD=sharenpo_pw --from-literal='ACCESS_TOKEN_SECRET=Ci-Access-Secret-2026-For-E2E-Test!' --from-literal='REFRESH_TOKEN_SECRET=Ci-Refresh-Secret-2026-For-E2E-Test!'

# 2. Images from current source — Docker Desktop's Kubernetes reads the local Docker image store, so there is no push or load step
docker build -t sharenpo-c13:local -f Dockerfile .
docker build -t sharenpo-frontend:local -f frontend/Dockerfile frontend
docker build -t sharenpo-admin:local -f admin/Dockerfile admin

# 3. Install (a fresh ClamAV pod downloads its signature DB, so allow several minutes)
cd k8s/helm
helm --kube-context docker-desktop -n c13-verify install c13 . --set secrets.existingSecret=c13-secrets --set env.DB_HOST=postgres --set env.DB_DATABASE=sharenpo --set env.BASE_URL=http://localhost:3000 --set image.repository=sharenpo-c13 --set image.tag=local --set image.pullPolicy=Never --set frontend.enabled=true --set frontend.image.repository=sharenpo-frontend --set frontend.image.tag=local --set frontend.image.pullPolicy=Never --set admin.enabled=true --set admin.image.repository=sharenpo-admin --set admin.image.tag=local --set admin.image.pullPolicy=Never --wait --timeout=600s

# 4. Pods, Services and endpoints
kubectl --context docker-desktop -n c13-verify get pods,svc,endpoints

# 5. In-cluster requests to each Service (the pod is removed when the command ends)
kubectl --context docker-desktop -n c13-verify run curl --image=curlimages/curl:latest --image-pull-policy=IfNotPresent --restart=Never --rm -i --command -- sh -c 'for u in c13-admin/admin c13-admin/admin/ c13-admin/admin/dashboard c13-admin/admin/assets/nope.js c13-admin/ c13-frontend/ c13-frontend/posts/1 c13-frontend/assets/nope.js c13:3000/health/ready; do printf "%s -> " $u; curl -s -o /dev/null -w "%{http_code}\n" http://$u; done'

# 6. Tear down
helm --kube-context docker-desktop -n c13-verify uninstall c13
kubectl --context docker-desktop delete namespace c13-verify
```

Expected: `STATUS: deployed`; app, frontend, admin, clamav and postgres pods `Running`; `c13`,
`c13-frontend` and `c13-admin` each with one endpoint address, all different; then `/admin` 301,
`/admin/` 200, `/admin/dashboard` 200, `/admin/assets/nope.js` 404, `c13-admin/` 404, frontend `/`
200, `/posts/1` 200, `/assets/nope.js` 404, and `c13:3000/health/ready` 200. The 2026-09-24 run
reused a two-day-old `sharenpo-frontend:local` and matched all of these.

**If Kubernetes never leaves "Starting"** (seen on Docker Desktop 4.48.0 with WSL kernel
`6.18.33.2`, 2026-09-24): the Docker Desktop log (`%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log`)
shows `kubelet` exiting a few seconds after start with `cgroup ["kubepods"] has some missing
controllers: cpuset`. Inside the `docker-desktop` WSL distro `cpuset` was in `cgroup.controllers`
but not in `cgroup.subtree_control`. What worked:

```bash
wsl -d docker-desktop -e sh -c 'echo +cpuset > /sys/fs/cgroup/cgroup.subtree_control'
```

then Settings > Kubernetes > **Reset Kubernetes Cluster** with "Enable Kubernetes" left checked
(unchecking it and pressing Apply & Restart is disabled while the cluster shows "Starting"). The
cluster was `Ready` about 26 seconds after the reset. The setting is not persistent: it is lost when
the Docker Desktop VM restarts (`wsl --shutdown`, quitting Docker Desktop), and it has to be
repeated. Why `cpuset` isn't delegated by default was not determined.

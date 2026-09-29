# ADR 0056: NetworkPolicy for cluster east-west traffic restriction

- Status: Accepted — implemented, kind+Calico-verified; the 2026-09-26 addendum turned the AWS agent on in code (`cluster/main.tf`), and the second 2026-09-26 addendum records the live run on EKS (agent, ALB ingress-allow rule and probes observed; the app's metrics scrape is blocked while Ingress is off), and the 2026-09-27 addendum puts a chart rule that admits Prometheus in place (code-complete; its checks are follow-up work)
- Date: 2026-09-11
- Extends: [ADR 0041](0041-helm-chart-project-adaptation.md)
- 한국어: [0056-networkpolicy-east-west-restriction.ko.md](0056-networkpolicy-east-west-restriction.ko.md)

## Context

A 2026-09-09 security review found `k8s/helm/templates/` had no `NetworkPolicy`
resource — nothing restricts pod-to-pod traffic inside the cluster once the app
is deployed. By default, Kubernetes allows any pod to reach any other pod;
without a `NetworkPolicy`, a compromised workload anywhere in the cluster could
reach the app pod directly, and the app pod itself has no restriction on what
it can reach outbound.

Two facts specific to this project's infrastructure shape the design more than
a generic NetworkPolicy would:

- **This app is a single Deployment.** There is no in-cluster microservice mesh
  to segment — DB is external RDS (`app-infra/main.tf`), object storage is
  external S3, and there is exactly one Deployment for this chart's pods. "Per
  component" rules therefore collapse to "what does this one pod's traffic
  actually look like," not "which of several pods may talk to which."
- **`k8s/infra/terraform/cluster/main.tf`'s `vpc-cni` addon uses its default
  configuration** — the VPC CNI Network Policy enforcement agent is not
  enabled. A `NetworkPolicy` resource applied to the real EKS cluster today
  would be created but not enforced. Turning on enforcement is a separate
  Terraform change (`cluster_addons.vpc-cni.configuration_values` with
  `ENABLE_NETWORK_POLICY`), out of this task's scope.
- **AWS VPC CNI assigns pod IPs directly from the VPC CIDR** (real ENI
  secondary IPs, not an overlay network) — pod IPs and node IPs share the same
  address space. An `ipBlock` cannot distinguish "the node's kubelet" from
  "another pod" on this CNI, unlike an overlay CNI (Calico/Cilium in overlay
  mode) where pod and node CIDRs are disjoint.
- **No S3 VPC Gateway Endpoint is provisioned** (`app-infra/main.tf` has a
  plain `aws_s3_bucket` only) — S3/AWS API traffic leaves the VPC over the
  NAT gateway to AWS's public endpoints, so it cannot be scoped to the VPC
  CIDR the way RDS traffic can.

## Decision

### D1 — One NetworkPolicy resource, gated like `ingress.yaml`/`servicemonitor.yaml`

`templates/networkpolicy.yaml` renders only when `networkPolicy.enabled` is
`true` (chart default `false`) — the same gating shape as the chart's two
existing optional resources. Unlike those two, the reason for defaulting off
isn't a missing CRD or missing DNS/cert mechanism — it's that the real
cluster's `vpc-cni` doesn't enforce `NetworkPolicy` yet (see Context). The
resource still renders under `values-prod.yaml` (`networkPolicy.enabled: true`,
added alongside `metrics.serviceMonitor.enabled: true`) so it takes effect the
moment the Terraform side turns enforcement on, without a second chart change.

### D2 — Egress is the primary control; ingress is deliberately minimal

`policyTypes` includes both `Ingress` and `Egress`, but they carry very
different weight given the single-Deployment topology (see Context):

- **Ingress**: `from: [{ podSelector: {} }]` — allow only from pods in the
  same namespace as the release, on the app's port. This blocks a pod in a
  *different* namespace from reaching the app directly; it does not attempt
  to distinguish kubelet's health-check traffic via an `ipBlock`, because pod
  IPs and node IPs are indistinguishable on this CNI (Context). AWS's own EKS
  documentation states node-sourced kubelet probes are automatically exempted
  under the VPC CNI Network Policy agent's "strict" enforcement mode, but a
  real counterexample is documented
  (`aws/amazon-vpc-cni-k8s#2571` — NetworkPolicy blocking liveness/readiness
  probes on that CNI in some configurations). Because of that documented risk,
  anyone flipping `vpc-cni`'s enforcement on for real must re-verify probes
  keep passing before relying on this in production — this chart's own kind
  verification (D4) used Calico, a different enforcement engine than AWS's
  agent, so it proves the policy's *shape* is correct but not that AWS's agent
  handles the kubelet-exemption case identically.
- **Egress**: default-deny with three explicit allows — DNS to CoreDNS
  (`namespaceSelector: {}` + `podSelector: {matchLabels: {k8s-app: kube-dns}}`,
  UDP/TCP 53), DB to `networkPolicy.egress.vpcCidr` (new value, default
  `10.0.0.0/16` matching `cluster/main.tf`'s `var.vpc_cidr` default) on
  `networkPolicy.egress.dbPort` (5432), and unrestricted-destination HTTPS
  (443) for S3/AWS API traffic — narrowing that last one to a CIDR isn't
  possible without an S3 VPC endpoint (Context), so only the port is
  restricted.

Given the single-Deployment topology, egress is where this policy does its
real work: it stops the app pod (if compromised — a supply-chain issue in an
npm dependency, for instance) from making arbitrary lateral connections inside
the cluster or exfiltrating over an arbitrary port, while ingress mainly closes
the "a workload in some other namespace reaches this pod directly" path.

### D3 — `networkPolicy.egress.vpcCidr` is an operator-supplied value, not hardcoded

The chart cannot know the real VPC CIDR (it's a Terraform variable,
`cluster/main.tf`'s `var.vpc_cidr`). `values.yaml` defaults it to `10.0.0.0/16`
to match that variable's own default; a deployment that applied Terraform with
a different `-var vpc_cidr=...` must override this value the same way it
already overrides `image.tag`/`env.S3_BUCKET`/etc.

### D4 — Verified against a throwaway kind + Calico cluster, not asserted

Following the ADR 0041 precedent (`helm install --wait` against a throwaway
local cluster before trusting a new template), this was verified 2026-09-11
against a `kind` cluster with the default CNI disabled and Calico (v3.28.0)
installed (`kind`'s own CNI does not enforce `NetworkPolicy`; Calico does). A
fresh image built from current source stood in for the published one; a
throwaway `postgres:16` pod stood in for RDS (its pod IP passed as
`networkPolicy.egress.vpcCidr=<ip>/32` for the test only — production uses the
real VPC CIDR). Checks performed and results:

- `helm install --wait` **succeeded** with `networkPolicy.enabled=true` — the
  Deployment reached `Ready`, meaning kubelet's liveness/readiness HTTP probes
  (ADR 0031 — readiness also checks DB connectivity) reached the pod despite
  the ingress restriction. This is Calico's kubelet-traffic handling, not a
  rule in this policy — see D2's caveat about AWS's agent being a different
  engine.
- `GET /health/live`, `GET /health/ready`, and `GET /doc` all answered `200`
  through the Service from a `curl` pod in the **same** namespace.
- A `curl` pod created in a **different** namespace timed out (`curl: (28)
  Connection timed out`) reaching the app pod's Service on its port — the
  ingress restriction is actually enforced, not a no-op.
- A `curl` pod carrying the app's own labels (so the policy's egress rules
  apply to it) timed out connecting to the throwaway Postgres pod's IP on
  port 9999 — an already-allowed **host** on a **non-allowlisted port** is
  still blocked, confirming the egress default-deny is real and not just
  "the three allowed paths happen to work."
- The migration Job (pre-install hook, writes to the throwaway Postgres over
  the allowed DB egress rule) completed successfully — `helm install --wait`
  would have failed at that hook otherwise — and the app pod's own logs show
  a clean `Nest application successfully started` with every route mapped,
  meaning DNS resolution for the Postgres Service name and the DB connection
  itself both worked over the allowed egress paths.

This does not prove the policy behaves identically once AWS's own Network
Policy agent is the real enforcement engine (D2) — that still needs its own
verification pass once `cluster/main.tf`'s `vpc-cni` enforcement is actually
turned on.

## Consequences

- A new `networkPolicy` values block (`enabled`, `egress.vpcCidr`,
  `egress.dbPort`) and `templates/networkpolicy.yaml` land in the chart;
  `values-prod.yaml` turns it on. `README.md`/`README.ko.md` document
  activation and the kind+Calico verification recipe.
- The feature is currently inert against the real (torn-down) EKS target: the
  `vpc-cni` addon's Network Policy enforcement agent is off. Turning it on is
  tracked as follow-up Terraform work, not part of this change.
- Ingress restriction is deliberately shallow (same-namespace only) rather
  than attempting a kubelet-specific allow — a correctness trade-off accepted
  because VPC CNI can't express "node, not pod" as an `ipBlock`, and because
  over-restricting ingress risks a production incident (probes failing) that
  is worse than the residual risk being accepted here.
- HTTPS egress (443) is open to any destination, not scoped to AWS's IP
  ranges or a VPC endpoint — provisioning an S3 VPC Gateway Endpoint in
  `app-infra/` would let this be tightened later; that's a separate,
  unscheduled Terraform task.
- Before ever enabling `vpc-cni`'s enforcement agent against the real cluster,
  re-verify `/health/live`/`/health/ready` keep passing under AWS's own
  Network Policy agent specifically (D2/D4's caveat) — do not assume the kind
  result transfers.

### Addendum (2026-09-22) — ALB ingress-allow rule added when Ingress is enabled

D2's ingress rule was `same-namespace pods only`, with no accommodation for
ALB traffic — Ingress was not yet a real routing path when this ADR was
written (`ingress.enabled` was, and still is, `false`). [ADR 0058](0058-ingress-path-allowlist.md)
and [ADR 0060](0060-frontend-same-alb-path-routing.md) since gave Ingress a
real shape (an explicit path allow-list, then a frontend Service sharing the
same ALB), and adding `alb.ingress.kubernetes.io/target-type: ip` for ADR
0060 (both this chart's Services are `ClusterIP`; the controller's `instance`
default needs `NodePort`/`LoadBalancer`) surfaced the gap directly: once
Ingress is ever turned on, the ALB's own ENIs try to reach the pod in `ip`
mode, and D2's ingress rule has no entry admitting them.

`templates/networkpolicy.yaml` gains a second ingress rule, rendered only
when `.Values.ingress.enabled` is `true`:

```yaml
- from:
    - ipBlock:
        cidr: {{ .Values.networkPolicy.egress.vpcCidr }}
  ports:
    - protocol: TCP
      port: {{ .Values.service.port }}
```

It reuses `networkPolicy.egress.vpcCidr` (D3) rather than adding a second
values key for the same CIDR. Both rules widen for the identical structural
reason: neither RDS (the egress DB rule) nor an ALB ENI (this new ingress
rule) is a pod, so `podSelector` cannot express either, and `ipBlock` is the
only mechanism `NetworkPolicy` offers for non-pod traffic.

**Accepted widening, stated plainly**: once `ingress.enabled` is `true`, this
rule admits the app's port from *anything* in the VPC CIDR, not only the
ALB's ENIs — every other pod and every node also sit inside that CIDR, and
standard `NetworkPolicy` has no selector that picks out "traffic that
actually came from the ALB" (no security-group-based selector exists in the
upstream API; that needs a CNI-specific extension this project doesn't use).
This is the same trade-off D2's egress DB rule already made, for the
identical reason — recorded here as a second instance of it, not a new kind
of risk. While `ingress.enabled` stays `false` (the default, and
`values-prod.yaml`'s current value — ADR 0060's "left to implementation"
list never turned it on), this rule does not render at all, so today's
`networkPolicy.enabled: true` posture is unchanged.

**Not verified.** `kind`+Calico (D4's own recipe) cannot stand in for this
check the way it did for the rest of the policy — a `kind` cluster's pod CIDR
has no relationship to a real VPC CIDR, so there is no way to simulate "a
non-ALB address inside `10.0.0.0/16`" against it meaningfully. This needs a
live EKS cluster with the real ALB Controller: confirm the ALB's target
group shows healthy targets (the `ip`-mode fix this rule accompanies) and,
per D2's own standing caveat, that AWS's VPC CNI Network Policy agent — not
Calico — enforces the rule identically. Listed as a live-only pending check
in `k8s/helm/README.md` ("Enabling HTTPS (Ingress)").

### Addendum (2026-09-26) — The VPC CNI agent is turned on in code; applying it and the live checks are follow-up work

The Context and D1 left one thing open: `values-prod.yaml` sets `networkPolicy.enabled: true`,
but `cluster/main.tf`'s `vpc-cni` add-on runs with its defaults, so the Network Policy agent
that enforces the rule is off and the policy is written but inert. **Decided by the developer
on 2026-09-26: turn enforcement on**, rather than leave the policy inert. The alternative —
keeping `vpc-cni = {}` — costs no code and cannot block any traffic, but leaves a firewall that
`values-prod.yaml` says is on doing nothing. Per D1 the policy then takes effect the moment the
agent is on, with no second chart change.

**The change is now in `cluster/main.tf`** (`vpc-cni` with `configuration_values`).
`terraform validate` and `fmt -check` pass in `cluster/`; it has never been planned or applied.

What turning it on takes, from AWS's EKS documentation (read 2026-09-26; not run):

- The add-on configuration value `{"enableNetworkPolicy": "true"}` — in this repo,
  `cluster_addons.vpc-cni.configuration_values = jsonencode({ enableNetworkPolicy = "true" })`
  in `cluster/main.tf`. (The `ENABLE_NETWORK_POLICY` that `k8s/infra/terraform/README.md`
  used to name is the self-managed add-on's setting, not the managed add-on's key.)
- VPC CNI `v1.14.0-eksbuild.3` or later, and node kernel `5.10` or later (the EKS-optimized
  Amazon Linux AMIs already have it). The add-on version is left unset, so the module picks
  the default for the cluster's Kubernetes version (`terraform-aws-modules/eks` `v20.37.2`
  passes `most_recent = null` to `aws_eks_addon_version`, which returns the default). EKS's
  API said on 2026-09-26 that the default for `1.34` is `v1.22.4-eksbuild.3` (newest
  `v1.23.1`) — well above the minimum. The default can change before an `apply`.
- The default "standard mode": a new pod starts with allow-all until its policies attach.
  `strict` mode (default-deny) is not chosen — it needs a policy for every endpoint a pod
  touches, CoreDNS included.
- The agent binds node ports `8162` (metrics) and `8163` (health probes); an app already using
  them fails.

**Follow-up work:**

1. Code — done 2026-09-26: the `cluster/main.tf` change above; `terraform init
   -backend=false`, `fmt -check` and `validate` pass in `cluster/`. Applying it comes with the
   rest of the stack (`deploy.sh cluster`).
2. Live checks once the agent is on (the developer runs them; the session records what is
   reported). They are also in `k8s/helm/README.md`'s Pending list:
   1. `aws-node` pods show two containers (the agent is the second) and the VPC CNI version is
      `v1.14.0-eksbuild.3` or later.
   2. The app pods become Ready and `/health/live` and `/health/ready` keep passing — kubelet's
      probes are not blocked (`aws/amazon-vpc-cni-k8s#2571`).
   3. The ALB's target group is healthy (the VPC-CIDR ingress rule above).
   4. With `ingress.enabled: false`, a pod in another namespace cannot reach the app pod
      (times out), and egress to a port that is not allow-listed times out — the enforcement
      is real, not just rendered. With Ingress on, the VPC-CIDR rule above admits other
      namespaces' pods too (the accepted widening), so no timeout is expected there.
   5. The allowed paths work: DNS, the database (5432), clamd (3310) and HTTPS/443 (S3). An
      EICAR upload is refused and a clean file passes (ADR 0059's AWS-only residual).
   6. Prometheus still scrapes the backend. The ingress rule admits same-namespace pods, plus
      the VPC CIDR when `ingress.enabled` is true, and Prometheus runs in another namespace —
      so with Ingress off the scrape may be blocked. An inference from the template, not
      observed.
   7. ExternalDNS, External Secrets and the ALB Controller are unaffected: the policy's
      `podSelector` is the app's labels only.

### Addendum (2026-09-26, later) — Live results on EKS

The developer applied the stack; the session ran the seven checks above itself: read-only calls
plus one probe script run inside the backend pod (TCP connects, a clamd `PING`, and clean bytes
sent to clamd; nothing was written). Times are UTC.

| # | Check | Result |
|---|---|---|
| 1 | Agent and VPC CNI version | Yes. `aws-node` was `2/2` on both nodes; the add-on was `v1.22.4-eksbuild.3`, `ACTIVE`, configuration `{"enableNetworkPolicy":"true"}`. |
| 2 | Probes not blocked | Yes. The backend was `1/1 Running` with 0 restarts and `/health/ready` answered `200` from inside the pod. The only Warning events were two readiness failures with `connection refused` during startup, which is the app not yet listening (a blocked probe would time out). |
| 3 | ALB target group | The rule works; the health check did not. The backend and admin groups first showed `unhealthy` with `Target.ResponseCodeMismatch [404]`, meaning the ALB's health check reached the pods and got an answer through the VPC-CIDR rule. The cause was the default health-check path `/` (fixed per Service, [ADR 0062](0062-admin-same-alb-subpath-routing.md) Addendum); after that all three groups were `healthy`. |
| 4 | Enforcement with Ingress off | Yes. From the backend pod, `s3.amazonaws.com:80` and the Prometheus pod's `:9090` timed out. Prometheus, which runs in another namespace, could not scrape the backend (`context deadline exceeded`). A dedicated pod in another namespace was not used; the failed scrape is the cross-namespace evidence. |
| 5 | Allowed paths | Mostly. From the backend pod, DNS resolved `sharenpo-clamav`, clamd answered `PING` with `PONG` and clean bytes with `stream: OK`, and `s3.amazonaws.com:443` connected. Port 5432 was not tried directly; `/health/ready` `200` (which pings the DB) implies it. clamd's log records `Eicar-Test-Signature FOUND` from the earlier backend pod's IP at 16:37; the HTTP `400 UPLOAD_MALWARE_DETECTED` response and a clean upload through the app were not observed by the session. |
| 6 | Prometheus scrape | Blocked while Ingress was off, as inferred: `up{job="sharenpo"}` was `0`. After the Ingress was enabled the VPC-CIDR ingress rule appeared and `up` was `1` (Prometheus's pod IP is inside `10.0.0.0/16`). |
| 7 | Other add-ons unaffected | Yes. ExternalDNS, External Secrets and the ALB Controller pods were `Running` and ExternalDNS created its records; no errors were seen. |

**Left open by this pass:** while Ingress is off the backend's metrics are not collected. A rule
admitting the `kube-prometheus-stack` namespace would close it; that is a chart change and was not
made here.

### Addendum (2026-09-27) — The Prometheus scrape rule is in the chart; its checks are follow-up work

The gap the previous addendum left open — Prometheus, in another namespace, cannot scrape the
backend's `/metrics` while `ingress.enabled` is false — is closed in the chart (`15229f6`).
`templates/networkpolicy.yaml` gains one ingress rule, rendered only when
`metrics.serviceMonitor.enabled` (`values-prod.yaml` sets it). Its single `from` entry carries a
`namespaceSelector` and a `podSelector` together, so it admits only Prometheus pods **in** that
namespace (AND), on the app's port. Both come from values: `networkPolicy.prometheus.namespace`
(default `kube-prometheus-stack`) and `networkPolicy.prometheus.podLabels` (default
`app.kubernetes.io/name: prometheus`). The namespace was observed on the live cluster. The pod
label was read from the Prometheus Service selector in the `kube-prometheus-stack` `48.2.3` chart;
no live pod's labels were listed. Helm merges maps, so overriding `podLabels` keeps the default
key; deleting it takes `null` (rendered and checked).

Alternatives weighed, in the order they were put to the developer, who chose the first:

- **Admit only Prometheus pods in the monitoring namespace** (chosen) — the narrowest rule that
  closes the gap.
- **Admit the whole monitoring namespace** — simpler, but every pod in it could reach the app's
  port, and `/metrics` is unauthenticated.
- **Turn the policy off** (`networkPolicy.enabled: false`) — closes the gap by losing D1's
  east-west restriction altogether.
- **Turn the ServiceMonitor off** — keeps the restriction, loses the backend's metrics
  ([ADR 0047](0047-observability-prometheus-grafana.md)).
- **Move Prometheus into the app's namespace** — needs no rule, but changes ADR 0047's placement
  and every other workload's scraping.

With Ingress on, the VPC-CIDR rule (D2 addendum) already admits Prometheus's pod IP, so the new
rule changes nothing then. It matters while Ingress is off, when that rule is not rendered.

**Checked by the session (2026-09-27):** `helm template` under five value sets — `values-prod.yaml`
(same-namespace rule plus the Prometheus rule), ServiceMonitor off (same-namespace rule only),
Ingress on (Prometheus rule, then the VPC-CIDR rule), an overridden namespace and labels (applied),
and the policy off (nothing rendered) — and `helm lint --strict`.

**Not checked — follow-up work:**

1. `kind`+Calico: a pod labelled `app.kubernetes.io/name=prometheus` in the configured namespace
   reaches the app pod; the same label in another namespace, and the right namespace without the
   label, both time out; a same-namespace pod still gets through. The commands are in
   `k8s/helm/README.md` > "Verifying the Prometheus scrape rule".
2. On the next live deployment, with Ingress off: Prometheus lists the backend target as `up`
   (before the rule it was `down`, `context deadline exceeded`), and
   `kubectl get pod -n kube-prometheus-stack --show-labels` shows `app.kubernetes.io/name=prometheus`
   on the Prometheus pod. Calico and AWS's agent are different enforcement engines (D2), so item 1
   does not stand in for this one.
3. Once both pass, this list and the pending bullet in `k8s/helm/README.md` become an observation.

### Addendum (2026-09-29) — baseline confirmed with Ingress on; the Ingress-off half is still open

The session queried the live Prometheus (`kubectl -n kube-prometheus-stack port-forward
svc/kube-prometheus-stack-prometheus 9090:9090`, then `GET /api/v1/targets`) with `Ingress`
**on** (its normal state during this session). The `job=sharenpo` target
(`sharenpo-79556dbc48-6cnmm`, endpoint `http`, `http://10.0.10.34:3000/metrics`) was `up`; no
`sharenpo-frontend` or `sharenpo-admin` job appeared at all — not `down`, simply absent, because
neither has a `ServiceMonitor` (only the backend exposes `/metrics`, ADR 0047). This matches
`k8s/helm/README.md`'s "Rollout and scraping" bullet.

**Still open: item 2 above (scrape while `Ingress` is off).** Toggling `ingress.enabled` is a
`helm upgrade` against the live release and briefly takes the public site off the domain, so this
session did not run it — that's the developer's call, not the session's. It was not attempted
here.

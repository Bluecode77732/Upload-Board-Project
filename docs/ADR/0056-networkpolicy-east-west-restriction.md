# ADR 0056: NetworkPolicy for cluster east-west traffic restriction

- Status: Accepted — implemented, kind+Calico-verified
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

# ADR 0044: Terraform Three-State Split — Cluster / Addons / App-Infra Lifecycle Separation

- Status: Accepted — implemented (`cluster/`/`app-infra/`/`addons/` split, the
  retired root `main.tf`/`variables.tf`/`outputs.tf`/`versions.tf`, and
  `README.md`/`README.ko.md` rewritten for the three-step apply order; see
  Addendum below); not yet applied against real AWS
- Date: 2026-08-19
- Amends: [ADR 0043](0043-terraform-project-adaptation.md) (its D1–D10 resource
  decisions — what gets provisioned and why — are unchanged; only the single-root-module
  packaging that ADR implemented is restructured here)
- Related: [ADR 0038](0038-terraform-iac-scaffold.md) (the scaffold this repo's
  Terraform directory started from), [ADR 0042](0042-k8s-helm-directory-consolidation.md)
  (the "no raw manifests outside the Helm chart" rule this ADR's subdirectories stay
  compliant with — they remain Terraform configuration, not Kubernetes manifests)
- 한국어: [0044-terraform-three-state-split.ko.md](0044-terraform-three-state-split.ko.md)

## Context

The developer asked to investigate and discuss separating "Cluster provisioning" and
"Helm/Kubernetes provisioning" lifecycles for the purpose of clean role division between
modules. Investigating the actual repo structure first (Hallucination Prevention):

- `k8s/infra/terraform/` (Cluster + AWS infrastructure: VPC, EKS, RDS, S3, Secrets
  Manager, Route53/ACM) and `k8s/helm/` (Kubernetes application resources: Deployment,
  Service, ConfigMap, Ingress, migration Job) are **already** lifecycle-separated by
  directory and by tool — a deliberate outcome of
  [ADR 0037](0037-helm-chart-scaffold.md)/[0038](0038-terraform-iac-scaffold.md)/
  [0041](0041-helm-chart-project-adaptation.md)/[0042](0042-k8s-helm-directory-consolidation.md)/
  [0043](0043-terraform-project-adaptation.md). ADR 0042's Consequences explicitly scoped
  itself away from the Terraform side ("`k8s/infra/terraform/` is untouched — this ADR is
  scoped to the manifests/chart split").
- An untracked, empty stub (`k8s/infra/cluster.yaml`, one line: `apiVersion: `) was found
  during this investigation. Its path/name echoes the `k8s/cluster/` raw-manifest
  directory ADR 0042 deleted. The developer confirmed the actual intent was **not** a raw
  Kubernetes manifest but an internal Terraform restructuring — that file is unrelated to
  this ADR's decision and is called out separately below (Consequences) since it still
  needs disposition.
- Inside `k8s/infra/terraform/`, `main.tf` bundles Cluster resources (`module.vpc`,
  `module.eks`) and Application-Infrastructure resources (RDS, S3 + IRSA, Secrets
  Manager, Route53/ACM) into **one Terraform state**. This means the cluster cannot be
  applied or destroyed independently of RDS/S3/Secrets/DNS — the actual gap the developer
  wants closed is inside Terraform's own root module, not between Terraform and Helm.

Tracing `main.tf`'s actual resource references (not assumed) found four coupling points
between what would naively be called "cluster" and "app-infra":

1. `module.vpc` is consumed by **both** `module.eks` (`vpc_id`, `subnet_ids`) and
   `aws_db_subnet_group.db` (`module.vpc.private_subnets`) — the VPC is a shared
   foundation, not cluster-exclusive.
2. `aws_security_group.rds`'s ingress rule sources `module.eks.node_security_group_id` —
   RDS's security group cannot be created before the EKS node group exists.
3. `aws_iam_role.app` (the S3 IRSA role, ADR 0043 D8)'s assume-role policy depends on
   `module.eks.oidc_provider_arn`/`oidc_provider` — same direction as (2).
4. `module.eks_blueprints_addons` (ALB Controller + External Secrets Operator) needs EKS
   outputs (`cluster_endpoint`, `oidc_provider_arn`, …) **and**
   `aws_secretsmanager_secret.app.arn` (an app-infra resource, for
   `external_secrets_secrets_manager_arns`). This addon layer straddles both sides — it
   is cluster tooling that cannot be fully configured without an app-infra output.

Point 4 is why a plain two-way split (cluster vs. app-infra) does not cleanly separate the
lifecycles: folding `eks_blueprints_addons` into either side leaves it needing a value
from the other, which either creates a circular reference between two states or forces an
artificial apply-order constraint that only half-achieves the goal.

## Decision

### D1 — Three Terraform root modules, three states, not two

Split `k8s/infra/terraform/` into three independently-appliable root modules:

- **`cluster/`** — `module.vpc`, `module.eks`. The VPC is grouped here (not app-infra)
  because its subnet/AZ layout exists to host the cluster; RDS is the consumer of an
  already-cluster-motivated resource, not the other way around.
- **`addons/`** — `module.eks_blueprints_addons` only. This is the one layer that
  structurally needs both other states' outputs (coupling point 4 above) — isolating it
  here means neither `cluster/` nor `app-infra/` needs to know about the other.
- **`app-infra/`** — `aws_db_instance.db` + supporting RDS resources, `aws_s3_bucket.app`
  + `aws_iam_role.app` (S3 IRSA), `aws_secretsmanager_secret.app`, `aws_route53_zone.app`
  + `aws_acm_certificate.app`.

### D2 — Reference direction: `addons` is the only two-way reader

`app-infra/` reads `cluster/`'s outputs via `terraform_remote_state` (for
`node_security_group_id`, coupling point 2/3) — one direction only; `cluster/` never
reads `app-infra/`. `addons/` reads **both** `cluster/` (EKS connection details) and
`app-infra/` (the Secrets Manager ARN) via `terraform_remote_state` — this is the exact
shape of coupling point 4, made explicit instead of folded into either side. `cluster/`
and `app-infra/` never reference each other directly.

This fixes the apply order: **`cluster` → `app-infra` → `addons`** (addons applies last
because it is the only consumer of an app-infra output).

### D3 — State backend: local, not a new S3 remote backend

`terraform_remote_state` blocks in `addons/` and `app-infra/` use `backend = "local"`
with a relative path to the producing state's directory. The purpose of this split is
lifecycle independence for a single developer's `apply`/`destroy` cycles, not
team/CI state sharing — introducing an S3+DynamoDB remote backend now would be a second,
unrequested scope expansion on top of a project that (per [ADR 0043](0043-terraform-project-adaptation.md) D1)
has not yet run `apply` against real AWS at all. `versions.tf`'s already-commented-out
`backend "s3" {...}` block (inherited, unmodified, from the original upstream scaffold —
[ADR 0038](0038-terraform-iac-scaffold.md)) stays commented out; it is not this decision's
backend.

### D4 — Directory layout: nested under the existing Terraform root

```
k8s/infra/terraform/
├── cluster/       (main.tf, variables.tf, outputs.tf, versions.tf)
├── addons/         (main.tf, variables.tf, outputs.tf, versions.tf)
└── app-infra/      (main.tf, variables.tf, outputs.tf, versions.tf)
```

Nesting under the existing `k8s/infra/terraform/` path (rather than flattening to
`k8s/infra/{cluster,addons,app-infra}/`) keeps every existing path citation into this
directory (CLAUDE.md's Terraform/infra entrypoint, ADR 0038/0043, this repo's README
cross-links) valid at the `k8s/infra/terraform/` prefix, and keeps the `terraform/`
segment doing the same naming work ADR 0042's Addendum already established for
`k8s/helm/` (a tool-named directory, not a repeated project-name directory).

### D5 — `variables.tf`/`outputs.tf` redistribution and new outputs

Each state declares only the variables its own resources need (e.g. `cluster/variables.tf`
keeps `region`, `cluster_name`, `vpc_cidr`, `node_desired_size_*`; `app-infra/variables.tf`
keeps `db_*`, `s3_bucket_name`, `domain_name`, `tags`).

`cluster/outputs.tf` must expose values that today are only consumed **within the same
state** via direct `module.eks.*` reference, and so are not yet outputs at all:
`node_security_group_id`, `oidc_provider_arn`, `oidc_provider`, and
`cluster_certificate_authority_data` (alongside the outputs that already exist today —
`cluster_endpoint`, `cluster_name`). Without these, `app-infra/` and `addons/` have no
`terraform_remote_state` value to read for coupling points 2–4.

## Alternatives rejected

- **Keep the single state (status quo)** — rejected: does not achieve the stated goal
  (independent cluster `apply`/`destroy`); RDS/S3/Secrets/DNS changes still enter the same
  plan as cluster changes.
- **Two-state split (`cluster`+`addons` combined / `app-infra`)** — rejected: `addons`
  needs `app-infra`'s Secrets Manager ARN, so folding addons into the cluster state either
  creates a circular dependency (`cluster+addons` → `app-infra` → back to
  `cluster+addons`) or forces `app-infra` to apply first even though it conceptually
  depends on the cluster existing — an apply-order compromise that only half-separates the
  lifecycles the developer asked to separate.
- **File-only split, single state kept** (`cluster.tf`/`app-infra.tf` inside one root
  module) — rejected: improves readability only; the shared state means a `terraform
  destroy` targeting cluster resources still plans against RDS/S3/Secrets/DNS, which does
  not close the actual gap.
- **S3 remote backend now** — rejected for this decision (see D3); revisit if/when a
  second person or a CI pipeline needs to `apply` this configuration, which is unscheduled
  work.

## Consequences

- `k8s/infra/terraform/main.tf`/`variables.tf`/`outputs.tf`/`versions.tf` (the former single
  root module) are retired in favor of the three subdirectories in D4 — **done, see
  Addendum below**.
- Apply/destroy order becomes explicit and enforced by data dependency, not just
  documentation convention: `cluster` first, `app-infra` second, `addons` last (D2).
  Destroying only `cluster` (e.g., to stop paying for EKS/node groups while keeping RDS
  data and the Route53/ACM/Secrets Manager setup) becomes possible for the first time —
  this is the concrete capability the split exists to provide.
- `k8s/infra/cluster.yaml` (the empty, untracked stub found during investigation) is
  **out of scope for this ADR** — it is a raw file directly under `k8s/infra/`, not
  Terraform configuration under any of the three directories D4 describes, and its
  name/location still collides with the pattern [ADR 0042](0042-k8s-helm-directory-consolidation.md)
  forbids. It needs its own disposition (delete, or fold into `cluster/` if it was meant
  as that state's placeholder) independent of this decision; the implementation below
  deliberately left it untouched.
- CLAUDE.md's Terraform/infra concern-to-entrypoint map now cites this ADR alongside
  ADR 0038/0043 as implemented, not merely decided — see Addendum below.
- No schema, entity, or API surface change. No code outside `docs/ADR/`,
  `k8s/infra/terraform/`, `docs/CLAUDE.md`/`.ko.md`'s Terraform entrypoint line, and
  `docs/ADR/README.md`/`.ko.md`'s index table was touched by this ADR's implementation.

### Addendum (2026-08-20) — three-state split implemented, still not applied

The design above is now the actual layout of `k8s/infra/terraform/`. Follow-up
implementation work (three prior tasks: `cluster/`, then `app-infra/`, then this one)
produced:

- `cluster/` (`module.vpc` + `module.eks`) and `app-infra/` (RDS, S3 + IRSA, Secrets
  Manager, Route53/ACM) as described by D1, `app-infra/` reading `cluster/`'s outputs via
  `terraform_remote_state` (D2).
- `addons/` (`module.eks_blueprints_addons` only), the sole state reading **both**
  `cluster/` and `app-infra/` via `terraform_remote_state` (D2) — its `kubernetes`/`helm`
  providers, and the `external_secrets_secrets_manager_arns` input, are wired exactly as
  D1's coupling-point-4 analysis described.
- `cluster/outputs.tf` exposes the D5 list (`node_security_group_id`, `oidc_provider_arn`,
  `oidc_provider`, `cluster_certificate_authority_data`) plus two gaps found while
  implementing `app-infra/` (`vpc_id`, `private_subnets` — coupling point 1) and one found
  while implementing `addons/` (`cluster_version` — the `module.eks_blueprints_addons`
  input the original single root module read directly off `module.eks.cluster_version`,
  which D5's output list did not anticipate). Same pattern each time: a value only ever
  consumed via direct in-state module reference becomes unreachable once the state
  boundary sits between producer and consumer, so it has to become an output.
- The retired root `main.tf`/`variables.tf`/`outputs.tf`/`versions.tf` are deleted, not
  kept as dead files alongside the three subdirectories.
- `k8s/infra/terraform/README.md`(+`.ko.md`) rewritten for the three-step
  `cluster` → `app-infra` → `addons` apply/destroy sequence, including the destroy-order
  reversal (`addons` → `app-infra` → `cluster`) D2's remote-state read direction implies
  but D1–D5 never spelled out.
- `docs/ADR/README.md`(+`.ko.md`)'s index row and CLAUDE.md's(+`.ko.md`) Terraform/infra
  concern-to-entrypoint line updated to describe this ADR as implemented.

`terraform init -backend=false`, `terraform fmt -check`, and `terraform validate` all
pass in all three directories. **`terraform apply` was not run in any of them** — no real
AWS resources exist from this work, matching ADR 0043's own not-yet-applied status; this
ADR does not change that.

`k8s/infra/cluster.yaml` was left exactly as found (per explicit instruction for this
task) — its disposition is still the separate, undecided follow-up the Consequences above
describe.

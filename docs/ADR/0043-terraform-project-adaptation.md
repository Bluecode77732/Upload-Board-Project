# ADR 0043: Terraform Project Adaptation — Real AWS Resources, Verified via Live Apply

- Status: Accepted — implemented (`main.tf`/`variables.tf`/`outputs.tf`/
  `versions.tf`/`README.md` rewritten against this design; see Addendum
  below); not yet applied against real AWS
- Date: 2026-08-18
- Amends: [ADR 0038](0038-terraform-iac-scaffold.md) (lifts its "defer the rewrite"
  decision, the same way [ADR 0041](0041-helm-chart-project-adaptation.md) lifted
  [ADR 0037](0037-helm-chart-scaffold.md)'s deferral on the Helm side)
- Related: [ADR 0029](0029-storage-port-adapter.md) (the S3 bucket + app IRSA role
  this ADR designs is `S3Storage`'s real target), [ADR 0030](0030-container-non-root-and-arch-stance.md)
  (the node-architecture question this ADR was explicitly deferred to),
  [ADR 0033](0033-secrets-delivery-target.md) (the ESO/IRSA/Secrets Manager wiring
  this ADR designs), [ADR 0034](0034-https-termination-stance.md) (the ALB/ACM
  ingress shape this ADR designs), [ADR 0035](0035-arm64-bcrypt-source-rebuild.md)
  (corrects this ADR's own first-draft framing — see Context), [ADR 0041](0041-helm-chart-project-adaptation.md)
  (the live-verification precedent D1 cites)
- 한국어: [0043-terraform-project-adaptation.ko.md](0043-terraform-project-adaptation.ko.md)

## Context

[ADR 0038](0038-terraform-iac-scaffold.md) recorded `k8s/infra/terraform/` as an
unmodified upstream `terraform-aws-eks-blueprints` "EKS Cluster w/ Istio" example:
it provisions a generic EKS cluster, VPC, and Istio addons — no S3 bucket, no
Postgres target, no secrets resource, no ALB/ingress this project's own ADRs call
for — and deferred the rewrite because no AWS account existed yet to `plan`/`apply`
against, and the ADR 0033/0034 shapes it would need to encode were themselves still
design-only.

Two things changed since: the Helm chart's project adaptation
([ADR 0041](0041-helm-chart-project-adaptation.md)) landed and was verified against
a throwaway `kind` cluster, and this session confirmed a live AWS account is
available for this task. Both of ADR 0038's blocking conditions are cleared.

This ADR is the design/decision pass this rewrite needs before any Terraform code
changes — six architecturally significant questions ADR 0029/0033/0034/0030 left
open (verification depth, database shape, node architecture, certificate source,
domain readiness, and how to treat the Istio-specific resources) were resolved with
the developer, 2026-08-18, and are recorded below.

This ADR's own drafting repeated the same discipline lapse ADR 0035 names in its
Consequences — see this ADR's own Consequences section below for the full record.

## Decision

### D1 — Verification scope: real AWS, through `apply`, not `plan`-only

The developer initially scoped this task to structure-only (no live `plan`/`apply`),
then explicitly re-decided to verify through a real `terraform apply` once shown the
precedent: [ADR 0041](0041-helm-chart-project-adaptation.md)'s addendum ran
`helm install --wait` against a throwaway `kind` cluster and found two real bugs
(`pre-install` hook ordering, empty-string optional env vars) that `helm lint
--strict`/`helm template` could not have caught — errors only visible once
resources are actually reconciled against a live API server. The same category of
gap applies here: `terraform plan` cannot catch a broken IAM trust policy, an IRSA
role that doesn't actually let ESO read the Secrets Manager entry, a security group
that doesn't actually let EKS nodes reach RDS, or an ALB Ingress Controller that
doesn't actually provision an ALB from the chart's `Ingress` resource. Those are
exactly the class of error `apply` surfaces and `plan` does not.

Accepted trade-off, stated plainly: `apply` incurs real hourly AWS charges (EKS
control plane, RDS instance, NAT Gateway, ALB) for as long as the resources exist,
and `terraform destroy` inherits the upstream README's documented VPC
dependency-violation caveat (the ALB Ingress Controller's asynchronous resource
reconciliation can outlive the `destroy` command, same as the Istio ingress case the
current README describes) — teardown needs the same kind of manual
target-then-destroy sequence, now against the AWS Load Balancer Controller's
resources instead of Istio's.

### D2 — Database: RDS PostgreSQL (managed)

A managed `aws_db_instance` (Postgres engine, matching `DB_TYPE=postgres`) is the
target for the 8 required env vars' `DB_HOST`/`DB_PORT`/`DB_DATABASE`. Rejected
alternative: a self-hosted Postgres inside the cluster (`StatefulSet` + `PVC`) —
this project already used exactly that shape once, disposably, for the Helm
`kind`-cluster smoke test (ADR 0041 addendum), and it was explicitly a throwaway
there. Running it as the permanent target would mean this project owns Postgres
backup, failover, and patching itself, for no benefit over RDS at this scale — RDS
is the standard choice a portfolio-scale AWS deployment reaches for exactly this
job, with no countervailing constraint here that would justify hand-rolling it.

The instance sits in the VPC's private subnets (reusing the module's existing
`private_subnets` output for the DB subnet group — a project this size does not
need a third, database-only subnet tier), reachable only from the EKS node security
group on 5432, never publicly.

### D3 — Node architecture: heterogeneous node groups, not a single either/or choice

**Corrected from this ADR's own first draft (see Context's Process note).** The
premise "arm64 needs extra work" is false: [ADR 0035](0035-arm64-bcrypt-source-rebuild.md)
already verified `bcrypt@6.0.0`'s bundled arm64 prebuild works with no compile step,
and this project's published image is already built for both platforms
(`linux/amd64,linux/arm64`) via `buildx`. Because the image is already a multi-arch
manifest list, Kubernetes resolves the correct platform-specific layer per node
automatically on pull — no `nodeSelector`/`nodeAffinity` on `kubernetes.io/arch` is
needed for this to work correctly on either node type.

That removes the reason to pick only one. `eks_managed_node_groups` declares two
groups instead of the scaffold's single `initial` group:

```
eks_managed_node_groups = {
  graviton = {
    instance_types = ["m6g.large"]     # arm64 — primary capacity
    min_size = 1, max_size = 5, desired_size = 2
  }
  x64 = {
    instance_types = ["m5.large"]      # amd64 — idle fallback
    min_size = 0, max_size = 2, desired_size = 0
  }
}
```

`graviton` carries the real desired capacity (Graviton's typical ~20% price/perf
edge over comparable x64 instances is the reason to default here — a real cost
lever with zero adaptation cost per ADR 0035); `x64` sits at `desired_size = 0` —
zero idle cost — present only as a manually-scalable fallback if Graviton capacity
or availability ever becomes a constraint in `ap-northeast-2`. This is not "cover
both bases speculatively" (Scope Discipline would reject that) — it is exercising a
capability (multi-arch scheduling) this project's image already committed to and
already paid the verification cost for (ADR 0035), at literally zero additional
implementation cost.

### D4 — Certificate source: ACM

[ADR 0034](0034-https-termination-stance.md) named the ALB/ingress target but left
the certificate source open ("ACM-issued, or cert-manager + Let's Encrypt").
Decided: ACM.

| Criterion | ACM | cert-manager + Let's Encrypt |
|---|---|---|
| Issuing authority | AWS-managed CA | Let's Encrypt (free public CA) |
| Cluster component | None — ALB references the cert directly | Requires installing and operating `cert-manager` in-cluster |
| DNS requirement | Route53 zone (or a hosting zone that can hold a validation record) | HTTP-01 (via Ingress) or DNS-01 (Route53 API) challenge — also needs a domain |
| Renewal | Fully AWS-managed, automatic | Automatic, but a cluster-internal component becomes a new failure point |
| Portability | Tightly coupled to the ALB's `certificate-arn` annotation | Cloud-independent — reusable if this project ever left AWS |
| Fit for this project | This stack is already fully AWS-committed (EKS, RDS, S3, ALB) | The portability advantage has no target — nothing in ROADMAP.md names a multi-cloud goal |
| Operational cost | Low | Slightly higher (one more component to manage) |

Given the stack's existing AWS commitment and the absence of any stated
multi-cloud goal, ACM's only real advantage over cert-manager's (portability) goes
unused here, while ACM's operational simplicity is a direct win. Decided: ACM.

### D5 — Domain: Route53 hosted zone provisioned by Terraform; the domain itself is a manual pre-`apply` step

No domain is currently owned. Terraform provisions an `aws_route53_zone` from a
required `domain_name` variable (no default — see D10), and DNS-validates the ACM
certificate against records in that zone. **Actual domain registration/purchase is
explicitly out of this Terraform config's scope** — a first-time domain purchase
(via Route53 Domains or an external registrar) is an interactive, non-idempotent
action that does not fit `terraform apply`'s repeatable-convergence model the way
provisioning an already-owned domain's zone does. The developer completes this
manually before the first `apply` that depends on it (buy the domain, or point an
existing external registrar's nameservers at the zone Terraform creates) — documented
as a README prerequisite (see Consequences), not automated.

### D6 — Istio-specific resources: removed entirely, not commented out

`kubernetes_namespace_v1.istio_system`, the `istio-base`/`istiod`/`istio-ingress`
entries in `eks_blueprints_addons`' `helm_releases`, and the
`node_security_group_additional_rules` block (ports 15017/15012, which exist
specifically for the Istio sidecar-injection webhook) are deleted, not commented
out. Reasoning:

- [ADR 0038](0038-terraform-iac-scaffold.md) already rejected the equivalent
  half-measure on its own resource set ("drop the Istio-specific resources now,
  keep the rest... risks looking more done than it is") — commenting Istio out
  instead of removing it is the same half-measure in a different form.
- ROADMAP.md already names Istio as "planned after Terraform... own ADR" — meaning
  Istio gets its own dedicated Terraform change with its own ADR later, at which
  point whatever is commented out here would need re-deriving against whatever the
  cluster and addons module version look like by then anyway. Dead commented code
  is not a time savings for that future task.
- The **AWS Load Balancer Controller addon is kept**, via the same
  `eks_blueprints_addons` module — it is a distinct capability from Istio's ingress
  gateway (the upstream example's `enable_aws_load_balancer_controller = true` exists
  "to expose Istio Ingress Gateway," but the controller itself provisions an ALB
  for any Kubernetes `Ingress` resource, Istio or not). Decoupling it from Istio is
  exactly what D9 needs: this project's own `Ingress` (the Helm chart's, currently
  disabled — [ADR 0041](0041-helm-chart-project-adaptation.md)) needs an ALB
  Ingress Controller with no service mesh underneath it.

### D7 — Secrets delivery: lands ADR 0033's ESO/IRSA target

[ADR 0033](0033-secrets-delivery-target.md) named the target shape (ESO syncing an
AWS Secrets Manager entry into a native `Secret`, authenticated via IRSA) but
deferred building it, pending exactly this Terraform work. This ADR designs it:

- An `aws_secretsmanager_secret` holding the four values the Helm chart's
  `secrets.existingSecret` already expects (`DB_USERNAME`, `DB_PASSWORD`,
  `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`) — generated via `random_password`
  inside Terraform state, never typed into a `.tfvars` file or committed anywhere
  (consistent with [ADR 0041](0041-helm-chart-project-adaptation.md)'s rejection of
  any code path that can hold a literal secret value).
- An IRSA role (IAM role trusted by the EKS cluster's OIDC provider, scoped to
  ESO's service account) with a policy permitting `secretsmanager:GetSecretValue`
  on that one secret's ARN only.
- ESO installed into the cluster (as a `helm_release`, the same mechanism
  `main.tf` already uses for other cluster addons — chart `external-secrets` from
  `https://charts.external-secrets.io`).
- A `SecretStore`/`ExternalSecret` resource syncing the Secrets Manager entry into
  a native `Secret` named to match what the Helm chart's `secrets.existingSecret`
  value must reference — output from Terraform so the value is copy-pasteable into
  the eventual `helm install --set secrets.existingSecret=...` step.

**Unverified, flagged rather than asserted**: whether `aws-ia/eks-blueprints-addons`
(the module `main.tf` already depends on) has a built-in `enable_external_secrets`-
style flag that installs ESO and provisions its IRSA role in one step is *not*
confirmed here — this ADR does not assert that API exists from memory
(Hallucination Prevention #2). Checking the module's actual registry documentation
against the pinned `~> 1.16` version is Prompt 2 implementation work; if the flag
exists, it replaces the hand-rolled `helm_release` + IAM role above with a few
module input lines — if not, the hand-rolled shape above is the fallback.

### D8 — S3 bucket + app IRSA role: lands ADR 0029's `S3Storage` cutover precondition

A private `aws_s3_bucket` (default SSE, `aws_s3_bucket_public_access_block` fully
blocking public access — reads happen through the app's presigned-redirect path,
[ADR 0036](0036-s3-presigned-content-redirect.md), never a public bucket policy),
named from a required `s3_bucket_name` variable (S3 bucket names are globally
unique — no safe default exists, see D10). A second IRSA role, distinct from D7's
ESO role, scoped to the application's own service account, with a policy permitting
`s3:GetObject`/`PutObject`/`DeleteObject`/`ListBucket` on that bucket only — this is
what lets `S3Storage`'s `new S3Client({ region })` (ADR 0029 D3 — no explicit
credentials, SDK default provider chain) actually resolve working credentials once
`STORAGE_DRIVER=s3` is set.

### D9 — ALB Ingress Controller: kept, decoupled from Istio, lands ADR 0034's target

Per D6, `eks_blueprints_addons`' `enable_aws_load_balancer_controller = true` is
kept but its Istio-specific `helm_releases` entries and framing are removed. Once
this Terraform lands, the Helm chart's already-built but disabled `Ingress`
template ([ADR 0041](0041-helm-chart-project-adaptation.md)) can be enabled with
`kubernetes.io/ingress.class: alb` and `alb.ingress.kubernetes.io/certificate-arn`
(pointing at D4/D5's ACM certificate) — the literal target
[ADR 0034](0034-https-termination-stance.md) named. Enabling it is Helm-chart
`values.yaml` work for a later task, not this ADR.

### D10 — `variables.tf` shape

| Variable | Type | Default | Rationale |
|---|---|---|---|
| `region` | string | `"ap-northeast-2"` | Promoted from the scaffold's hardcoded `locals.region` (already fixed by commit `d6587f9`) to an overridable variable |
| `cluster_name` | string | `"upload-board-project"` | Replaces `basename(path.cwd)` — a directory-name-derived default is fragile across clones/CI checkouts |
| `vpc_cidr` | string | `"10.0.0.0/16"` | Unchanged from the scaffold — no reason found to change it |
| `node_desired_size_graviton` / `node_desired_size_x64` | number | `2` / `0` | D3 |
| `db_instance_class` | string | `"db.t4g.micro"` | Portfolio-scale default (also Graviton-based, consistent with D3's cost stance); overridable |
| `db_allocated_storage` | number | `20` | Minimum practical RDS `gp3` size |
| `db_name` | string | `"upload_board"` | Matches `DB_DATABASE` naming already used in `.env.example`'s example values |
| `db_username` | string | `"upload_board_admin"` | Not secret — the password is (D7 generates it, never a variable) |
| `s3_bucket_name` | string | **required, no default** | Globally unique — cannot have a safe default (D8) |
| `domain_name` | string | **required, no default** | Real value only the developer can supply (D5) |
| `tags` | map(string) | `{}` | Passed through to `local.tags`, additive to the existing `Blueprint`/`GithubRepo` tags |

No variable holds a secret value — D7/D8's credentials are Terraform-generated
(`random_password`) and stored only in Secrets Manager and Terraform state, never
in `variables.tf`, a `.tfvars` file, or version control.

## Alternatives rejected

- **Keep verification at `plan`-only** — superseded by the developer's explicit
  re-decision (D1) once shown the ADR 0041 precedent.
- **Self-hosted Postgres in-cluster** — rejected in favor of RDS (D2).
- **A single node group, either all-x64 or all-arm64** — this ADR's own first-draft
  framing (see Context's Process note); corrected to D3's heterogeneous design once
  the false "ARM needs extra work" premise was caught.
- **cert-manager + Let's Encrypt** — rejected given this stack's existing full AWS
  commitment and the absence of any multi-cloud goal in ROADMAP.md (D4).
- **Comment out the Istio-specific resources instead of deleting them** — rejected
  for the same half-measure reasoning [ADR 0038](0038-terraform-iac-scaffold.md)
  already used to reject it on the original resource set (D6).
- **Automate domain registration in Terraform** — not pursued; a first-time
  interactive domain purchase does not fit Terraform's idempotent-convergence
  model the way an already-owned domain's hosted zone does (D5).

## Consequences

- ROADMAP.md's Stage 4 component-status table: the Terraform row's description
  needs to move from "scaffold only, `variables.tf` empty" to "project-specific
  design finalized (ADR 0043), implementation pending" — the 🔶 status symbol itself
  does not flip to ✅ from this ADR alone, consistent with how ADR 0033 stayed
  📝 design-only until code actually landed behind it. The Secrets delivery and
  HTTPS termination rows gain a concrete implementation design (D7/D4) but keep
  their current status symbols for the same reason. Tracked as a follow-up doc
  update, not applied in this ADR's diff.
- `docs/ADR/README.md` and `README.ko.md` gain a row for this ADR (this diff).
- **No Terraform code changes land with this ADR.** `main.tf`, `variables.tf`, and
  `README.md` under `k8s/infra/terraform/` are rewritten in a follow-up task against
  this design — this ADR is the decision record that task implements against, the
  same relationship [ADR 0041](0041-helm-chart-project-adaptation.md) has to the
  Helm chart it describes.
- Once implemented and applied: real, recurring AWS charges (EKS control plane,
  RDS instance, NAT Gateway, ALB) for as long as the resources exist; `terraform
  destroy` inherits the upstream README's documented VPC dependency-violation
  caveat, now against the AWS Load Balancer Controller's resources (D1).
- A domain must be registered (manually) and its nameservers pointed at the
  Terraform-created Route53 zone before the ACM certificate can DNS-validate (D5)
  — a README prerequisite for the follow-up task, not something this ADR resolves.
- No schema, entity, or API surface change. No code outside `docs/ADR/` touched by
  this ADR.
- **Process note — three compounding errors in this ADR's own drafting, all
  developer-caught, none self-caught before being asked about.** D3's design
  (heterogeneous node groups) only emerged after three separate mistakes on the
  same question, each corrected in turn rather than all at once:
  1. **False premise.** The first draft of the node-architecture question
     presented x64-vs-ARM as a trade-off requiring extra work on the ARM side (a
     `bcrypt` source rebuild) — asserted from memory, without first checking that
     [ADR 0035](0035-arm64-bcrypt-source-rebuild.md) had already verified the
     arm64 prebuild works with no compile step. This shaped the developer's first
     answer ("keep x64"), which was therefore made on incorrect information.
  2. **Re-asking instead of deciding, after the premise was corrected.** Once the
     false premise was caught (while reading `docs/ADR/README.md` to add this
     ADR's own index row — not from independently re-verifying the earlier
     answer) and disclosed, the correct next step was to decide ARM outright and
     state the reasoning: the corrected facts left no real trade-off (ARM
     strictly cheaper, zero added implementation cost, already verified). A
     second question was asked anyway, presenting it as if a judgment call still
     remained. The developer pushed back directly ("why ask this again?").
  3. **Still anchored on the scaffold's single-node-group shape.** Even that
     second, corrected question kept framing x64 and ARM as mutually exclusive —
     because it silently inherited the original scaffold's
     `eks_managed_node_groups` structure (exactly one group, one
     `instance_types` list) instead of reconsidering whether that structure was
     the right one to keep. It took the developer asking directly ("what should
     I choose so both can be implemented?") to surface that a heterogeneous
     two-node-group design was both possible and strictly better, given the
     image is already multi-arch (this ADR's own Context, D3).
  This is the same Hallucination Prevention discipline
  [ADR 0035](0035-arm64-bcrypt-source-rebuild.md) names in its own Consequences
  ("verify every assumption... applies to ADRs, not only code"), recurring three
  times within the drafting of the very ADR meant to apply that lesson, and
  caught only because the developer kept asking why rather than accepting each
  answer at face value.

### Addendum (2026-08-18) — Terraform code implemented, validated, not yet applied

The "no Terraform code changes in this ADR" line this ADR's own Status
originally carried no longer describes `k8s/infra/terraform/`. A follow-up
implementation task rewrote `main.tf`/`variables.tf`/`outputs.tf`/
`versions.tf`/`README.md` (+ `README.ko.md`) against D1–D10 above:
`module.eks`'s two heterogeneous node groups (D3), `aws_db_instance` in
private subnets reachable only from the EKS node security group (D2), a
private `aws_s3_bucket` + a dedicated app IRSA role (D8),
`aws_secretsmanager_secret` + `eks_blueprints_addons`'s
`enable_external_secrets` flag (D7), and `aws_route53_zone` +
`aws_acm_certificate` with DNS validation (D4/D5). The Istio-specific
resources were deleted outright, not commented out (D6).

`terraform init -backend=false`, `terraform fmt -check`, and `terraform
validate` all pass. **`terraform apply` was not run** — no real AWS resources
exist from this work; the recurring-AWS-charge consequence D1 accepted has
not actually been incurred yet.

Two things D7's own text had left open were resolved or decided during
implementation:

- **D7's "Unverified" flag is resolved.** `aws-ia/eks-blueprints-addons`
  does carry `enable_external_secrets` (confirmed by reading the module
  source at the pinned `~> 1.16` constraint, tag `v1.16.0`) — it installs
  the ESO Helm release, creates its IRSA role, and annotates its service
  account in one step. The hand-rolled `helm_release` + `aws_iam_role`
  fallback D7 described was not needed.
- **How the `SecretStore`/`ExternalSecret` objects actually get created —
  not fully specified by D7.** Terraform's `kubernetes_manifest` resource
  cannot declare a CRD instance in the same `apply` that installs the CRD
  defining it (a documented provider limitation — ESO's own Helm release
  must already be running for the schema to exist). Rather than splitting
  `apply` into two phases, the manifest content is rendered as a plain
  Terraform *output* (`external_secrets_manifest`) and applied once,
  manually, via `kubectl apply` — the same shape D5 already uses for domain
  registration (something that doesn't fit Terraform's idempotent-
  convergence model either, so it stays a documented manual step).

**New residual gap, documented in the rewritten README, not fixed here**:
`aws_iam_role.app`'s trust policy targets
`system:serviceaccount:default:default`, because the Helm chart
(`k8s/helm/`) does not yet render a dedicated `ServiceAccount` — annotating
`default` with this role's ARN grants S3 access to every pod in the
namespace that uses it, not only this app's. A dedicated `ServiceAccount`
template is a follow-up Helm-chart task, mirroring how D9 already left
enabling the chart's `Ingress` as later work.

This addendum is also the trigger for the doc updates this ADR's own
Consequences section (above) named as a follow-up: `docs/ROADMAP.md`'s
Terraform, Secrets delivery, and HTTPS termination rows, and this ADR's row
in `docs/ADR/README.md`, are updated in the same change as this addendum.

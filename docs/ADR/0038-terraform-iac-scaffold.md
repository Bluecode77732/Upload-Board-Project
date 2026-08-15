# ADR 0038: Terraform IaC — Upstream EKS+Istio Example Landed, Not Yet Project-Specific

- Status: Accepted (scaffold only — not deployable as-is)
- Date: 2026-08-11
- Related: [ADR 0037](0037-helm-chart-scaffold.md) (same situation, Helm side);
  CHANGELOG.md > Known issue (2026-08-13, the SSL `rejectUnauthorized: false`
  change touches files this ADR also covers — see Consequences)
- 한국어: [0038-terraform-iac-scaffold.ko.md](0038-terraform-iac-scaffold.ko.md)

## Context

The Stage 4 "production DevOps stack introduction" row (ROADMAP.md §6) names
Terraform as one of eight components, to declaratively provision the AWS
resources this project's deployment will need (network, cluster, S3, secrets).
Commit `c661fc4` ("Adopt: Infra/Terraform; IaC") added
`k8s/infra/terraform/` — like the Helm scaffold ([ADR 0037](0037-helm-chart-scaffold.md)),
it landed with no CHANGELOG entry, no ROADMAP component-status update, and no
ADR.

Inspecting the directory directly: `README.md` is the **unmodified upstream
README** from AWS's `terraform-aws-eks-blueprints` "EKS Cluster w/ Istio"
example — it still describes deploying Istio, installing the Istio Ingress
Gateway, and validating Istio communication with a sample application, none of
which is this project. `main.tf` declares `aws`/`kubernetes`/`helm` providers
and provisions a generic EKS cluster, a VPC (`module "vpc"`), and Istio-related
addons (`module "eks_blueprints_addons"`, a `kubernetes_namespace_v1`
`istio_system` resource) — infrastructure for the example's own scenario, not
resources this project actually needs: no S3 bucket for
[ADR 0029](0029-storage-port-adapter.md)'s storage-driver cutover, no RDS or
equivalent matching this project's `DB_*` env vars, no secrets-manager resource
for [ADR 0033](0033-secrets-delivery-target.md), no ALB/ingress for
[ADR 0034](0034-https-termination-stance.md). `variables.tf` is **empty (0
bytes)** — nothing about this configuration is actually parameterized.

Two later commits touched it lightly without changing this picture: `d6587f9`
fixed a hardcoded region typo (`ap-west-2` → `ap-northeast-2`), and `41c8c2c`
bumped a provider/lock-file version and, in the same commit, added
`backend/app.module.ts`'s production-only
`ssl: { rejectUnauthorized: false }` — a change to a different concern
(application-level DB TLS handling) that happened to ride along with a
Terraform-file edit; it is tracked separately (CHANGELOG.md > Known issue,
2026-08-13) and is not resolved by this ADR.

## Decision

- **Record the scaffold as landed**, moving the Stage 4 component-status
  table's Terraform row from 🆕 to a real, if generic and unadapted, base.
- **Do not describe it as this project's infrastructure.** As written, running
  `terraform apply` against it provisions AWS's example EKS+Istio environment,
  not anything this backend needs — it declares no S3 bucket, database, secrets
  resource, or ingress this project's own ADRs call for.
- **Defer the rewrite** rather than doing it as part of this documentation
  pass: the concrete resource list depends on decisions this project has
  already made in design-only ADRs ([0033](0033-secrets-delivery-target.md) secrets
  target, [0034](0034-https-termination-stance.md) ingress/ALB stance) but not yet
  provisioned, plus a node-group/instance-family choice ADR 0030 deferred
  pending exactly this Terraform work.

## Alternatives rejected

- **Write a from-scratch, project-specific Terraform config now** — rejected
  for the same reason as [ADR 0037](0037-helm-chart-scaffold.md): no AWS
  account exists yet to `plan`/`apply` against, so hand-written resource blocks
  would be unverified and the ADR 0033/0034 shapes they'd need to encode are
  themselves still design-only.
- **Drop the Istio-specific resources now, keep the rest** — rejected as a
  half-measure: `variables.tf` being empty and the README being verbatim
  upstream text are bigger signals of non-adaptation than the Istio pieces
  specifically, and a partial edit here risks looking more "done" than it is
  without actually producing infrastructure this project can deploy onto.

## Consequences

- ROADMAP.md's Stage 4 "Production DevOps stack — component status" table:
  Terraform row moves from 🆕 to 🔶 (upstream scaffold landed, project-specific
  resources not yet declared).
- Follow-up (tracked in ROADMAP > Unscheduled, not scheduled as its own task
  yet): replace `main.tf`'s resource set with what this project actually needs
  (S3 bucket, a Postgres target matching `DB_*`, IAM/secrets per
  [ADR 0033](0033-secrets-delivery-target.md), ALB/ingress per
  [ADR 0034](0034-https-termination-stance.md)), populate `variables.tf`, and
  replace `README.md`. This also unblocks the ARM/Graviton node-group decision
  [ADR 0030](0030-container-non-root-and-arch-stance.md) deferred to "the
  Terraform node-group decision."
- Does **not** resolve the `backend/app.module.ts` SSL-validation question
  (CHANGELOG.md > Known issue, 2026-08-13) even though the commit that
  introduced it also touched files this ADR covers — that stays tracked
  separately and needs its own investigation before a code change.
- No schema, entity, or API surface change. No code outside
  `k8s/infra/terraform/` touched by this ADR.

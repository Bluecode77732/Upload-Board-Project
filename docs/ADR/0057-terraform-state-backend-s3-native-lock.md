# ADR 0057: Terraform State Backend — S3 with Native Locking, No DynamoDB, No KMS

- Status: Accepted — code-complete, not applied (bucket creation and state migration
  deferred to actual deployment time)
- Date: 2026-09-12
- Amends: [ADR 0044](0044-terraform-three-state-split.md) D3 (revisits its "local backend,
  revisit once a second developer or CI pipeline needs to apply" stance earlier than that
  trigger, for a different reason — see Context)
- 한국어: [0057-terraform-state-backend-s3-native-lock.ko.md](0057-terraform-state-backend-s3-native-lock.ko.md)

## Context

A 2026-09-09 security review of `k8s/infra/terraform/` found that all three states
(`cluster/`, `app-infra/`, `addons/`) use Terraform's default local backend (no `backend`
block in any `versions.tf`), and that `app-infra/main.tf`'s `random_password.db`,
`random_password.access_token_secret`, and `random_password.refresh_token_secret`
resources land their `.result` values in plaintext inside the local `terraform.tfstate` —
Terraform state stores every resource attribute in plaintext regardless of a provider's
`sensitive` marking; this is inherent Terraform behavior, not a bug in this repo's config.
Confirmed by reading `app-infra/main.tf` directly (lines 83, 104, 208, 213, 226-232) rather
than assumed.

At the time of the review this carried zero actual risk — all three states are currently
empty (no resources tracked; the live AWS stack this project applied 2026-08-25–27 was
fully destroyed 2026-08-28, see ROADMAP.md §9) — but risk activates at the next real
`apply`, and switching backends while every state is empty is the cheapest possible time to
do it (no `-migrate-state` step actually moves tracked resources, only an empty resource
list).

ADR 0044 D3 already named the S3+DynamoDB-lock trigger ("once a second developer or CI
pipeline needs to apply this configuration") and deliberately deferred it as an unrequested
scope expansion at a time nothing had ever been `apply`d. This ADR does not disagree with
that reasoning for *why* local was fine in August — it revisits the *conclusion* because a
different trigger (a concrete plaintext-secret exposure, not team growth) now applies, and
because two Terraform features that did not exist as GA when ADR 0044 was written changed
what "remote backend" actually costs:

- **S3 native locking** (`use_lockfile`) — GA in Terraform 1.11 (this project's installed
  CLI is 1.15.8). Uses S3 conditional writes (`PutObject` with `If-None-Match`) to create a
  `.tflock` object instead of a separate DynamoDB table.
- **SSE-S3** (`encrypt = true`, AES256) has always been free and built into S3 — the
  original ADR 0044 D3 alternative ("S3+DynamoDB-lock ... remote backend") implicitly
  assumed SSE-KMS-or-nothing, which is what made it feel like a bigger step than it is.

The developer and I discussed and rejected several alternatives before settling on the
approach below (recorded fully in session, summarized in Alternatives rejected).

## Decision

### D1 — Storage backend: S3, one bucket, one key per state

Each of the three states' `versions.tf` gains a `backend "s3" {}` block (`cluster/` uses key
`cluster/terraform.tfstate`, `app-infra/` uses `app-infra/terraform.tfstate`, `addons/` uses
`addons/terraform.tfstate` — one bucket, key-prefixed, not three buckets). The bucket name is
**not committed** — a `terraform { backend }` block cannot reference variables (Terraform
evaluates it before the rest of the config), so the name is supplied via
`terraform init -backend-config="bucket=<value>"` at init time, mirroring the existing
no-committed-default convention for globally-unique names (`s3_bucket_name`, ADR 0043 D8).
Proposed name: `sharenpo-tfstate` — confirmed globally available via
`aws s3api head-bucket --bucket sharenpo-tfstate` (404 Not Found = unclaimed) at decision
time; this is not a guarantee it stays available until the bucket is actually created.
`region` is a literal (`"ap-northeast-2"`, matching `var.region`'s existing default) for the
same reason — backend blocks can't read `var.region` either. If the region default ever
changes, this literal needs a matching manual update in all three `versions.tf`.

### D2 — Locking: S3 native (`use_lockfile = true`), not DynamoDB

Requires `required_version = ">= 1.11"` in all three `versions.tf` (bumped from `>= 1.3`).
No DynamoDB table, no extra IAM surface for one. A Terraform state lock table under
on-demand billing was already close to $0 regardless of which backend won — the point of
skipping DynamoDB isn't the (negligible) cost, it's one fewer resource and one fewer set of
IAM permissions to provision and maintain for identical locking behavior.

### D3 — Encryption: SSE-S3 (`encrypt = true`), not SSE-KMS

Deliberate deviation from the general production default. The usual reason production
Terraform state buckets default to SSE-KMS isn't cost (a customer-managed key is a flat
$1/month, confirmed via AWS's own pricing page) — it's that KMS decouples "who can
`s3:GetObject`" from "who can decrypt," via a separate key policy, with a CloudTrail audit
trail. That value requires a second principal to separate access *from*. This AWS account
(`074416822640`) has exactly one human principal (the developer, IAM user `sharenpo-user`);
there is no one to withhold decrypt access from that S3 read access doesn't already reach.
SSE-S3 already closes the actual gap this ADR exists for (plaintext at rest) at zero
marginal cost. See D6 for when this should be revisited.

### D4 — `terraform_remote_state` data sources also move to S3 (not deferrable)

`app-infra/main.tf`'s `data.terraform_remote_state.cluster` and `addons/main.tf`'s
`data.terraform_remote_state.cluster`/`data.terraform_remote_state.app_infra` previously
read `backend = "local"` with a relative path (`${path.module}/../cluster/terraform.tfstate`,
etc.) — this was a *second*, separate use of "local," distinct from each state's own
storage backend (D1), and ADR 0044 D3's "local" wording covered both without
distinguishing them. Once `cluster/`'s and `app-infra/`'s real state lives in S3, those
relative-path reads no longer resolve to anything meaningful, so this move is not optional
follow-up work — it has to land in the same change as D1 or `app-infra`/`addons` cannot
read the outputs they depend on. Unlike the top-level `backend` block, `data
"terraform_remote_state"` blocks are ordinary data sources and *can* read variables, so a
new `tfstate_bucket_name` variable (no default, same reasoning as `s3_bucket_name`) was
added to `app-infra/variables.tf` and `addons/variables.tf` instead of a second
`-backend-config` mechanism.

### D5 — Bucket creation and migration deferred to actual deployment time

This ADR does not create the bucket or run `terraform init -migrate-state`. All three
states are currently empty, so there is nothing to migrate yet, and this AWS account
already has live credentials configured — creating the bucket now would be a real,
if inexpensive, AWS side effect with no corresponding deploy happening. `k8s/infra/terraform/README.md`
gains a one-time runbook step (manual `aws s3api create-bucket` +
`put-bucket-versioning` + `put-public-access-block`, then `terraform init
-backend-config=...` in each of the three directories, `cluster` → `app-infra` → `addons`
order) to run once, at the point a real `apply` is actually about to happen.

### D6 — Future trigger: reconsider SSE-KMS (not DynamoDB) once this account has a second principal

If this AWS account ever gains a second human or service principal (a second developer, a
CI pipeline with its own IAM role) that should be able to read the state bucket without
also being able to decrypt it, or if a compliance requirement (audit trail, mandatory key
rotation) applies, switch `encrypt = true` to `kms_key_id = <arn>` — KMS's value proposition
activates the moment there is a second identity to separate decrypt access from. This does
**not** bundle DynamoDB back in: `use_lockfile` provides the same distributed-locking
guarantee regardless of how many principals apply concurrently, so team/pipeline growth is
not itself a reason to reintroduce DynamoDB. This corresponds to the "team/project scale"
trigger the developer asked to have recorded, stated precisely rather than as a blanket
"switch back to option (a)."

## Alternatives rejected

- **S3 + DynamoDB + KMS now** (the literal shape ADR 0044 D3 named) — superseded by D1–D3
  above: `use_lockfile` (GA since this ADR 0044 was written) makes DynamoDB unnecessary for
  locking, and this account's single-principal shape makes KMS's real benefit inapplicable
  today (see D3, D6).
- **Terraform Cloud (HCP Terraform)** — $0 AWS cost, built-in state encryption, but a new
  external SaaS account/workspace dependency not part of ROADMAP's stated DevOps stack
  (AWS/Docker/K8s/Helm/GitHub Actions/Prometheus/Grafana/Terraform/Istio).
- **Keep local backend, encrypt the host disk instead** (BitLocker or similar) — this
  development machine is Windows 10 **Home**, which does not ship traditional BitLocker;
  the lighter "Device Encryption" feature depends on hardware conditions (TPM, Modern
  Standby) this machine's support for was not confirmed. Even if available, it would leave
  the structural problem (single local copy, no locking, no durability across machines)
  unsolved. Rejected as unreliable for the stated goal, not merely as a worse option.
- **Terraform's own local-state encryption** (`encryption` block, `pbkdf2` key provider —
  GA since 1.9) — genuinely solves "no plaintext at rest" at $0 with no AWS resource at
  all. Rejected in favor of D1–D3 because it leaves the state a single local file with no
  off-machine durability or locking (both of which S3 solves for the same near-zero
  marginal cost) and introduces a new failure mode — passphrase loss permanently locks the
  state — that S3 + IAM does not have an equivalent of.
- **Create the bucket now, verify the migration works, then delete it** — considered
  explicitly and rejected: this reverts to exactly the plaintext-local state this ADR
  exists to fix (the whole point is a *persistent* backend, not a one-time proof it's
  possible), and S3 bucket names are globally unique across every AWS account, not just
  this one — deleting `sharenpo-tfstate` and recreating it later is not guaranteed to
  succeed if another account claims the name in between, for a cost saving that doesn't
  exist (an idle S3 bucket's cost is already negligible).

## Consequences

- `cluster/versions.tf`, `app-infra/versions.tf`, `addons/versions.tf`: `required_version`
  bumped `>= 1.3` → `>= 1.11`; each gains a `backend "s3" {}` block (D1/D2/D3).
- `app-infra/main.tf`, `addons/main.tf`: `data.terraform_remote_state` blocks move from
  `backend = "local"` + relative path to `backend = "s3"` + `var.tfstate_bucket_name` (D4).
- `app-infra/variables.tf`, `addons/variables.tf`: new `tfstate_bucket_name` variable (no
  default, D4).
- `k8s/infra/terraform/README.md`(+`.ko.md`): "Future" section rewritten from "unscheduled"
  to a concrete one-time bootstrap runbook (D5); apply/plan command examples gain
  `-var="tfstate_bucket_name=<value>"` alongside the existing `-var="s3_bucket_name=..."`.
- `docs/ROADMAP.md`(+`.ko.md`) §7: the "Terraform remote state backend" entry marked
  decided/code-complete, no longer unscheduled.
- `terraform init -backend=false`, `terraform fmt -check`, and `terraform validate` pass in
  all three directories with these changes (verified this session). **No `terraform init`
  against the real S3 backend and no `apply` were run** — no AWS resources exist from this
  ADR; D5 governs when that changes.
- No schema, entity, or API surface change — this ADR is scoped entirely to
  `k8s/infra/terraform/` and its documentation.

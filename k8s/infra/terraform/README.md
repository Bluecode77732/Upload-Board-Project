# sharenpo (Terraform)

> 한국어: [README.ko.md](README.ko.md)

Provisions the AWS infrastructure this repo's Helm chart (`k8s/helm/`) deploys
onto: an EKS cluster, RDS PostgreSQL, an S3 bucket, the ESO/IRSA secrets
pipeline, and an ALB-fronted, ACM-certificated ingress path. See
[ADR 0043](../../../docs/ADR/0043-terraform-project-adaptation.md) for why each
resource exists and the alternatives that were rejected;
[ADR 0038](../../../docs/ADR/0038-terraform-iac-scaffold.md) for this
directory's scaffold history;
[ADR 0044](../../../docs/ADR/0044-terraform-three-state-split.md) for why the
configuration below is split into three independently-appliable states
instead of one root module.

**Status**: **not applied — a full teardown, not the original scaffold gap.**
All three states, plus the app itself (Helm), were applied against real AWS
2026-08-25–27 and confirmed working end-to-end (ADR 0039's Addendum records a
TLS-verification fix made against that live RDS instance). Once the deploy
was proven, everything was destroyed 2026-08-28 to stop the AWS bill — no EKS
cluster, RDS instance, S3 bucket, Route53 zone, NAT gateway, or EC2 instance
from this stack currently exists (verified via `aws eks/rds/ec2/elb` describe
calls, all empty/not-found). `terraform validate` and `terraform fmt -check`
still pass in all three state directories. The ExternalDNS record and name-server pinning
([ADR 0063](../../../docs/ADR/0063-alb-dns-externaldns-and-delegation-set.md)) are
code-complete in `app-infra/`, `addons/`, and `deploy.sh` and, like the rest, unapplied.

This status is a snapshot, not a promise — a future `apply` can make it true
again in minutes, and someone re-reading this file later should re-verify
with `terraform plan` rather than trust this paragraph. When applying, run
`terraform plan` and read it before any `apply`, and never `destroy`
casually — the RDS instance carries `skip_final_snapshot = true` and
`deletion_protection = false`, so anything that replaces or destroys it takes
the data with it and leaves no final snapshot (this is exactly why the prior
teardown was a deliberate, confirmed decision, not a casual one). ADR 0043's
and ADR 0044's addenda still say this config had never been applied; they are
left as written because an ADR records what was true when written — see
[ROADMAP.md §7](../../../docs/ROADMAP.md#7-unscheduled--open-decisions) for
the fuller history and the deferred identifier rename (ADR 0043 D1).

## Three states, one apply order

```
k8s/infra/terraform/
├── cluster/       module.vpc + module.eks
├── app-infra/      RDS + S3/IRSA + Secrets Manager + Route53/ACM
└── addons/         module.eks_blueprints_addons (ALB Controller + ESO + ExternalDNS)
```

Each directory is an independent Terraform root module with its own local
state file (`terraform.tfstate`, gitignored) — there is no single `terraform
apply` for the whole thing. The apply order is fixed by data dependency, not
just convention (ADR 0044 D2):

1. **`cluster/`** first — no dependencies on the other two.
2. **`app-infra/`** second — reads `cluster/`'s outputs via
   `terraform_remote_state` (VPC/subnet IDs, the EKS node security group, the
   OIDC provider) for the RDS security group and the S3 IRSA role's trust
   policy.
3. **`addons/`** last — the only state that reads **both** others: EKS
   connection details from `cluster/`, and from `app-infra/` the Secrets
   Manager ARN (`external_secrets_secrets_manager_arns`) and the Route53
   zone's ARN and name (`external_dns_route53_zone_arns` and ExternalDNS's
   `domainFilters`, [ADR 0063](../../../docs/ADR/0063-alb-dns-externaldns-and-delegation-set.md)).
   This is why it cannot run before `app-infra/` exists.

Each state's own `terraform.tfstate` — and, for `app-infra/`/`addons/`, the
`terraform_remote_state` reads of the other states' outputs — live in an S3
bucket with native locking and SSE-S3 encryption, not Terraform's local-file
default ([ADR 0057](../../../docs/ADR/0057-terraform-state-backend-s3-native-lock.md),
amending ADR 0044 D3's original "local, revisit once a second developer or
CI pipeline needs to apply" stance — a 2026-09-09 security review found
`app-infra/`'s generated secrets landing in plaintext in the local state
file, which made switching worth doing sooner). No DynamoDB table, no KMS
key — S3's native `use_lockfile` (GA in Terraform 1.11) and free SSE-S3
cover locking and encryption without either; see the ADR for why (this AWS
account has exactly one human principal, so KMS's access-separation value
doesn't apply yet — D6 names the trigger for revisiting that). Run every
command below from inside the directory it's shown under; `terraform init`
must be run separately in each of the three, and now needs
`-backend-config="bucket=<value>"` (see bootstrap step below) every time.

**One-time bootstrap, before the first `apply` after this change**: the S3
bucket a `backend "s3" {}` block points at has to exist before `terraform
init` can use it — Terraform doesn't create its own backend. This is a
manual, one-time step (deliberately not a fourth Terraform root module — ADR
0057 Alternatives rejected), run once, not repeated per apply:

```sh
aws s3api create-bucket --bucket <globally-unique-tfstate-bucket-name> \
  --region ap-northeast-2 \
  --create-bucket-configuration LocationConstraint=ap-northeast-2
aws s3api put-bucket-versioning --bucket <that-bucket-name> \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket <that-bucket-name> \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Then, in each of the three directories, `terraform init -backend-config="bucket=<that-bucket-name>"`
(or, via `deploy.sh`, set `TFSTATE_BUCKET_NAME=<that-bucket-name>` — every
`deploy.sh` command below already expects it). This bucket is meant to
persist — it is not something to tear down after verifying it works, the
way the EKS/RDS stack below was (see ADR 0057 Alternatives rejected for why
that was considered and rejected for this bucket specifically).

## Before you `apply` anything

1. **A domain you can point DNS at.** `app-infra/` creates a Route53 hosted
   zone for `var.domain_name` and DNS-validates an ACM certificate against
   it, but does **not** register or purchase the domain itself (ADR 0043
   D5) — that is an interactive, non-idempotent action outside Terraform's
   model. Buy the domain first (Route53 Domains or any registrar), then
   either delegate it to the zone this config creates (point your
   registrar's nameservers at the `route53_zone_name_servers` output) or run
   `apply` once first just to get that output, then delegate.

   **Or pin the name servers once** ([ADR 0063](../../../docs/ADR/0063-alb-dns-externaldns-and-delegation-set.md)
   D4) — worth it if you will destroy and re-`apply` more than once. Create a
   reusable delegation set outside Terraform, put its four name servers at
   the registrar once, and give its ID to `app-infra/`; every zone created
   afterwards gets the same four, so the delegation below never repeats. The
   domain's own registration stays where it is (Route53 Domains is not
   involved):
   ```sh
   aws route53 create-reusable-delegation-set --caller-reference sharenpo-ns-1
   ```
   The output's `DelegationSet.NameServers` are the four values for the
   registrar. `DelegationSet.Id` looks like `/delegationset/N1PA6795SAMPLE` —
   keep only the part after the last `/` (the `delegation_set_id` variable
   rejects the prefix, because the AWS provider stores the ID without it).
   Pass it as `DELEGATION_SET_ID=<id>` to `deploy.sh`, or as
   `-var="delegation_set_id=<id>"` by hand. To read the name servers again
   later: `aws route53 get-reusable-delegation-set --id <id> --query
   'DelegationSet.NameServers'`. Leave the set alone: it is not part of any
   state, so `terraform destroy` does not touch it, and AWS lets you delete
   it only once no zone uses it. When you run `plan` and `apply` separately
   through `deploy.sh`, give both the same `DELEGATION_SET_ID`. This has not
   been run against real AWS yet.

   Without a delegation set (the variable unset), this is what applies:
   ⚠️ **This delegation must be redone after every `terraform destroy` +
   re-`apply` of `app-infra/`, not just the first time** — AWS assigns a
   brand-new set of 4 nameservers to every newly created hosted zone, even
   for the identical domain name. From inside `app-infra/`, re-run
   `terraform output route53_zone_name_servers` (no `-raw` — this output is
   a list, and `-raw` only supports string-typed outputs) and update your
   registrar with the new values; the old ones from a prior apply no longer
   point anywhere. Skipping this makes the ACM certificate validation hang
   or fail with no obvious error pointing back to DNS.
   **On Windows, that `terraform output` will typically fail while the
   `app-infra` apply is still running**, with `Error: Failed to read state
   file ... The process cannot access the file because another process has
   locked a portion of the file` — Windows' file locking is stricter than
   Linux/macOS, and the running `apply` holds an exclusive lock on
   `terraform.tfstate` the whole time it's active (this is why the apply is
   still running in the first place — it needs the nameservers delegated
   before its own ACM-validation wait can succeed). Query AWS directly
   instead; it doesn't touch the local state file at all:
   ```sh
   aws route53 list-hosted-zones-by-name --dns-name <your-domain> \
     --query 'HostedZones[0].Id' --output text
   aws route53 get-hosted-zone --id <that Id> \
     --query 'DelegationSet.NameServers' --output json
   ```
2. **A globally-unique S3 bucket name** for `app-infra/`'s
   `var.s3_bucket_name` — bucket names collide across all AWS accounts, not
   just yours.
3. **A second, separate globally-unique S3 bucket for Terraform state itself**
   (`TFSTATE_BUCKET_NAME` / `-backend-config="bucket=..."` /
   `var.tfstate_bucket_name`) — see the one-time bootstrap step above
   ([ADR 0057](../../../docs/ADR/0057-terraform-state-backend-s3-native-lock.md)).
   Must not be the same bucket as `s3_bucket_name` above (that one holds
   app-uploaded media, not Terraform state).
4. **AWS credentials** with permission to create EKS/RDS/S3/IAM/Route53/ACM
   resources, and the `aws`/`kubectl`/`helm` CLIs installed locally (the
   `kubernetes`/`helm` providers in `addons/` shell out to `aws eks
   get-token`).
5. **`region`/`cluster_name` must match across all three `.tfvars`/`-var`
   invocations.** These are plain variables, not shared via
   `terraform_remote_state` — passing a different `cluster_name` to
   `app-infra/` than you did to `cluster/` produces a config that plans
   successfully but names/tags resources inconsistently.

## Deploy

**Quick reference — commands only, in order** (a fresh full deploy; skip to "Scripted entry
point" below for what each one actually does):

```sh
cd k8s/infra/terraform
export TFSTATE_BUCKET_NAME=<globally-unique-tfstate-bucket-name>  # bootstrapped once, see above

# 1. cluster
bash deploy.sh cluster

# 2. app-infra (needs a purchased domain. Without DELEGATION_SET_ID this apply
#    pauses mid-run for NS delegation; with the reusable delegation set from
#    "Before you apply anything" below — its name servers already at your
#    registrar — it should not have to wait on the registrar (not yet run).
#    See that section before running it)
S3_BUCKET_NAME=<globally-unique-bucket-name> DOMAIN_NAME=<your-domain> \
  DELEGATION_SET_ID=<set-id-without-prefix> bash deploy.sh app-infra

# 3. addons
bash deploy.sh addons

# 4. point kubectl at the new cluster
eval "$(terraform -chdir=cluster output -raw configure_kubectl)"

# 5. one-time: sync the app's DB/S3 secret into the cluster (not automated
#    by deploy.sh — see "After all three apply" below for why)
terraform -chdir=app-infra output -raw external_secrets_manifest | kubectl apply -f -

# 6. helm (dev's latest image by default; add "main" to deploy main's instead)
bash deploy.sh helm
```

Every `plan`/`apply` inside `deploy.sh` still stops and asks for an explicit `y` — this
sequence skips no approval gate, it only orders the commands.

**Scripted entry point**: `k8s/infra/terraform/deploy.sh` wraps the three-state apply
order below plus `helm upgrade --install` in one script — plan-then-confirm on every
apply, no `-auto-approve` ([ADR 0046](../../../docs/ADR/0046-deploy-sequence-automation.md)).
Run `bash deploy.sh all` (or `cluster`/`app-infra`/`addons`/`helm` individually; `--help`
for env vars). It does **not** cover domain purchase, creating the reusable delegation set
and putting its name servers at the registrar, the ESO secret sync, or enabling `Ingress` —
those stay manual, covered further down this file. The optional `DELEGATION_SET_ID` is passed
through to every `app-infra` plan/apply ([ADR 0063](../../../docs/ADR/0063-alb-dns-externaldns-and-delegation-set.md) D4). The app's S3
IRSA role is wired automatically as of 2026-09-03 — `deploy.sh`'s `HELM_RELEASE` defaults
to `sharenpo`, matching both `values-prod.yaml`'s `serviceAccount.create: true` and
`app-infra/main.tf`'s trust policy, so no separate manual annotation step is needed on
top of `deploy.sh helm`/`deploy.sh all` (see "Known gap" below for the one-time Terraform
apply this still requires before it actually takes effect).

**Which branch's image gets deployed** (2026-09-04): `deploy.sh helm`/`deploy.sh all` no
longer trust whatever tag happens to be pinned in `values-prod.yaml` — every run resolves
the image fresh, from a branch, at deploy time. Default is `dev` (matching every real deploy
this project has done so far); pass a branch as the second argument to deploy from `main`
instead:

```sh
bash deploy.sh helm main   # deploy main's latest published image
bash deploy.sh helm        # deploy dev's latest published image (default)
```

This is per-invocation, not sticky — merging to `main` doesn't change what the next bare
`bash deploy.sh helm` deploys; you still type `main` every time you want it. To avoid
retyping across several commands in one session, set it once instead:

```sh
export DEPLOY_BRANCH=main   # this shell session only
bash deploy.sh helm         # now deploys main without the argument
```

Either form resolves the branch's current HEAD commit and checks Docker Hub for a matching
image tag before proceeding — a missing image (nothing published from that branch yet, or
CI still running) aborts with a clear error instead of silently deploying something stale.
`IMAGE_TAG=<tag>` remains as a raw override for anything neither branch's HEAD represents
(e.g. rolling back to an older sha). The frontend image (ADR 0060) and the admin image (ADR 0062)
use the same tag: the lookup checks `bluecode1775/sharenpo`, `bluecode1775/sharenpo-frontend` and
`bluecode1775/sharenpo-admin`, and the helm step passes the tag as `image.tag`, `frontend.image.tag`
and `admin.image.tag`. An explicit `IMAGE_TAG` skips the check for all three, so rolling back to a
sha from before the frontend or admin image existed leaves that pod without an image — run helm by
hand for that.

**Test deployment vs real deployment** ([ADR 0048](../../../docs/ADR/0048-ci-trigger-restoration-and-docker-publish-design.md)
Addendum, 2026-09-26): `dev` images are `amd64`-only and the only nodes that run are `arm64`
(Graviton), so a `dev` deploy to this cluster passes the tag check and then fails at pod start —
the bare `bash deploy.sh helm` default above is for tests, not for this cluster. Use `dev` for
tests (local, `kind`, Docker Desktop) and deploy for real from `main`, whose images carry `arm64`
too: merge `dev` into `main`, wait for CI to publish all three images, then
`bash deploy.sh helm main`. The script checks that a tag exists, not which platforms it carries,
and both branches use the same cluster and `values-prod.yaml`, so nothing in it stops the wrong
choice.

**Two more things `deploy.sh` does not guard.** Its `helm` step passes no `--kube-context`, so it
uses whichever `kubectl` context is current, and a kubeconfig keeps the contexts of clusters that
have since been torn down — run `kubectl config current-context` first and pass
`--context`/`--kube-context` on every command you run by hand. And node capacity is unmeasured:
`cluster/main.tf` gives two `t4g.medium` nodes about 17 pod slots each (its own comment), and this
is the first deployment where clamd, ExternalDNS, the frontend and the admin console run next to
the ALB Controller, External Secrets and the monitoring stack — if pods stay `Pending` with
`FailedScheduling`, raise `node_desired_size_graviton`.

**Plan/apply split** (ADR 0046 addendum, 2026-09-02): for `cluster`/`app-infra`/`addons`,
`bash deploy.sh plan <state>` computes and saves the plan to a fixed, gitignored path
and exits — no apply. `bash deploy.sh apply <state>` re-shows that saved plan and still
asks for an explicit `y` before applying it. Use this when the plan and the approval
won't happen back-to-back (e.g. you want to review it later rather than sit at the
terminal right after `plan` finishes) — the combined `cluster`/`app-infra`/`addons`/`all`
commands above are unchanged and still the simpler choice for a single continuous run.
Approval is required either way; the split only decouples *when* you approve from *when*
the plan was computed, not whether you do. The manual sequence below is what the script automates,
kept here as the reference for what each step actually does. This same order applies
whether it's the very first deploy or a full redeploy after a complete `terraform
destroy` (below) — nothing about the sequence changes.

```sh
# 1. cluster/
cd cluster
terraform init -backend-config="bucket=<globally-unique-tfstate-bucket-name>"
terraform apply

# 2. app-infra/ — reads cluster/'s state via terraform_remote_state
cd ../app-infra
terraform init -backend-config="bucket=<globally-unique-tfstate-bucket-name>"
# The apply below creates a new Route53 zone and waits, in the same run, for
# ACM to DNS-validate against it — it will hang until your registrar's
# nameservers point at this new zone. The zone doesn't exist until this
# apply creates it, so its nameservers can't be fetched beforehand — start
# this apply first, then, once it reaches the ACM wait, open a second
# terminal and fetch the new nameservers so you can delegate while this one
# waits:
#   aws route53 list-hosted-zones-by-name --dns-name <your-domain> \
#     --query 'HostedZones[0].Id' --output text
#   aws route53 get-hosted-zone --id <that Id> \
#     --query 'DelegationSet.NameServers' --output json
# These values are NEW every time this zone is (re-)created — after a
# `terraform destroy` + re-apply, old nameserver values no longer point
# anywhere and must be replaced at the registrar again.
# Optional (ADR 0063 D4): add -var="delegation_set_id=<set-id-without-prefix>" to
# pin the zone's name servers — see "Before you apply anything" above.
terraform apply \
  -var="s3_bucket_name=<globally-unique-bucket-name>" \
  -var="domain_name=<your-domain>" \
  -var="tfstate_bucket_name=<globally-unique-tfstate-bucket-name>"

# 3. addons/ — reads both cluster/'s and app-infra/'s state
cd ../addons
terraform init -backend-config="bucket=<globally-unique-tfstate-bucket-name>"
terraform apply -var="tfstate_bucket_name=<globally-unique-tfstate-bucket-name>"
```

No variable in any of the three states accepts a secret value — the four
values the Helm chart's `secrets.existingSecret` needs (`DB_USERNAME`,
`DB_PASSWORD`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`) are generated
by `app-infra/` (`random_password`) and only ever live in AWS Secrets
Manager and that state's Terraform state file (ADR 0043 D7/D8).

## Cleaning up after a failed apply

These are the actual failure modes hit while first deploying this stack
(ROADMAP.md §7); each leaves a specific kind of leftover that a plain retry
does not always clear on its own.

- **`helm install`/`upgrade` fails with a Helm release stuck in `failed`**
  (a pre-install/pre-upgrade hook — usually the migration `Job` — failed, or
  a webhook race like the AWS Load Balancer Controller's admission webhook
  not yet being ready when another chart tries to create a `Service`).
  Retrying the same `install`/`upgrade` fails again with `cannot reuse a
  name that is still in use` — Helm keeps a `failed` release under its name
  until it's explicitly removed. Fix the underlying cause first, then:
  ```sh
  helm uninstall <release-name> -n <namespace>
  ```
  before retrying. This does **not** touch anything Terraform manages — only
  the Kubernetes-side Helm release record and the resources it created.
- **Leftover `Error`/`Failed` Jobs and Pods** (e.g. a migration Job that
  failed a few times before the real fix landed) are harmless but clutter
  `kubectl get pods`. Deleting the Job also removes its Pods:
  ```sh
  kubectl delete job <job-name> -n <namespace>
  ```
- **An EKS node group stuck in `CREATE_FAILED`** (wrong `ami_type`, an
  instance type your AWS account can't launch, etc.) does **not** need
  manual AWS-side cleanup — the module's `eks-managed-node-group` submodule
  uses `lifecycle { create_before_destroy = true }`, so a still-working node
  group from a prior apply survives untouched. Fix `cluster/main.tf` (e.g.
  the instance type) and re-run `terraform apply`; it replaces just the
  failed node group.
- **`Error: Error acquiring the state lock`** after an interrupted (e.g.
  Ctrl-C'd) `terraform apply` — the S3 backend's native lock (`use_lockfile`,
  ADR 0057) leaves a `.tflock` object in the state bucket behind when the
  process doesn't get to release it cleanly. The error message itself prints
  the lock ID; use it exactly:
  ```sh
  terraform force-unlock <LOCK_ID>
  ```
  Only do this once you're sure no other `apply`/`plan` is actually still
  running against the same state — force-unlocking while a real process
  still holds the lock can corrupt the state file.

## After all three `apply`

1. **Point kubectl at the new cluster** — from `cluster/`: `terraform
   output -raw configure_kubectl` prints the command, run it.
2. **Sync secrets into the cluster** — the `SecretStore`/`ExternalSecret`
   objects that make External Secrets Operator mirror the Secrets Manager
   entry into a native `Secret` are custom resources (CRDs) that ESO's own
   Helm release (installed by `addons/`) must already be running to
   understand; Terraform's `kubernetes_manifest` resource cannot declare a
   CRD instance in the same `apply` that installs the CRD (a documented
   provider limitation), so this is a one-time manual step instead — the
   same shape ADR 0043 D5 already uses for domain registration. Run from
   `app-infra/` (the manifest references only that state's own Secrets
   Manager secret):

   ```sh
   cd app-infra
   terraform output -raw external_secrets_manifest | kubectl apply -f -
   ```

   Confirm it synced: `kubectl get externalsecret,secret
   $(terraform output -raw app_secret_k8s_name)`.
3. **Install the Helm chart**, wiring in `app-infra/`'s outputs:

   ```sh
   cd ../../helm
   helm install sharenpo . \
     --set secrets.existingSecret=$(terraform -chdir=../infra/terraform/app-infra output -raw app_secret_k8s_name) \
     --set env.DB_HOST=$(terraform -chdir=../infra/terraform/app-infra output -raw db_host) \
     --set env.DB_DATABASE=$(terraform -chdir=../infra/terraform/app-infra output -raw db_name) \
     --set env.STORAGE_DRIVER=s3 \
     --set env.S3_BUCKET=$(terraform -chdir=../infra/terraform/app-infra output -raw s3_bucket_name) \
     --set env.AWS_REGION=<same value as var.region> \
     --set env.BASE_URL=https://<your-domain>
   ```

## Known gap: the app's S3 IRSA wiring is code-complete but never applied

`app-infra/`'s `aws_iam_role.app` (output as `app_iam_role_arn`) is the IRSA
role that lets the app pod's AWS SDK client resolve S3 credentials once
`STORAGE_DRIVER=s3` is set (ADR 0029, ADR 0043 D8). As of 2026-09-03, every
piece of this is consistent and points at the same name, `sharenpo`:

- `app-infra/main.tf`'s `local.app_service_account_name` — this role's
  `assume_role_policy` condition-matches `system:serviceaccount:default:sharenpo`
- `k8s/helm/`'s `serviceaccount.yaml` template + `values-prod.yaml`'s
  `serviceAccount.create: true` (with the role's ARN hardcoded in its
  `annotations`, the same way `DB_HOST`/`S3_BUCKET` are — see
  `k8s/helm/README.md` > "Dedicated ServiceAccount for IRSA")
- `deploy.sh`'s `HELM_RELEASE` default — so the ServiceAccount the chart
  creates resolves to that same name with no `--set` needed

**None of this has been applied yet.** `terraform fmt -check`/`validate` pass
in `app-infra/` and `helm template`/`helm lint` render correctly with
`values-prod.yaml`, but `terraform plan`/`apply` was not run against this
change (see below), and there is currently no live cluster to install onto —
`aws eks list-clusters`/`aws rds describe-db-instances` both returned empty
2026-09-03, matching the "torn down to stop the bill" state this file already
describes above. The next `terraform apply` in `app-infra/` (via `deploy.sh`
or by hand) picks up the new trust policy automatically; no separate manual
step remains. The old manual workaround —
`kubectl annotate serviceaccount default eks.amazonaws.com/role-arn=...` —
**no longer applies once this trust policy is applied**: the role stops
trusting the `default` ServiceAccount entirely, so annotating it does nothing.
If a live cluster is ever redeployed with an **older** version of this
Terraform code (trust policy still targeting `default`) but this repo's
current Helm chart/`values-prod.yaml` (which no longer annotates `default`,
and instead creates+annotates a `sharenpo` ServiceAccount), IRSA breaks the
other way — keep the Terraform and Helm sides deployed from the same commit.

## Known gap: NetworkPolicy enforcement is code-complete but never applied (vpc-cni Network Policy agent)

`k8s/helm/`'s `templates/networkpolicy.yaml` ([ADR
0056](../../../docs/ADR/0056-networkpolicy-east-west-restriction.md)) restricts the app
pod's east-west traffic, and `values-prod.yaml` already sets `networkPolicy.enabled: true`.
Until 2026-09-26, though, `cluster/main.tf`'s `vpc-cni` addon used its default configuration
(`cluster_addons = { vpc-cni = {} }`), so the VPC CNI's Network Policy enforcement agent was
off and applying this against the real EKS cluster created the `NetworkPolicy` object without
enforcing it.

Turning enforcement on is a `cluster_addons.vpc-cni.configuration_values` change. **Decided
2026-09-26 to do it** ([ADR 0056's 2026-09-26 Addendum](../../../docs/ADR/0056-networkpolicy-east-west-restriction.md)):
the managed add-on's setting is `{"enableNetworkPolicy": "true"}` (the
`ENABLE_NETWORK_POLICY` this section used to name is the self-managed add-on's setting).
**The change is made** — `cluster/main.tf` sets it; `terraform validate` and `fmt -check`
pass, and it has never been applied — and the live checks are follow-up work listed in that
Addendum and in `k8s/helm/README.md`'s Pending list. Before applying
that change against a real cluster, re-verify `/health/live`/`/health/ready` still pass
under AWS's own Network Policy agent specifically: the kind+Calico verification ADR 0056
already ran proves the policy's shape is correct, but Calico and AWS's agent are different
enforcement engines, and a real AWS issue
(`aws/amazon-vpc-cni-k8s#2571`) documents a case where NetworkPolicy blocked
liveness/readiness probes on this CNI — do not assume the kind result transfers.

## Enabling the ALB ingress

The Helm chart's `Ingress` template exists but is disabled by default
(`ingress.enabled: false`, ADR 0041). Once `addons/` has applied (the ALB
Controller must be running to reconcile the `Ingress` object) and
`app-infra/` has the certificate, enable it with:

```sh
helm upgrade sharenpo . \
  --reuse-values \
  --set ingress.enabled=true \
  --set frontend.enabled=true \
  --set admin.enabled=true \
  --set ingress.className=alb \
  --set ingress.annotations."kubernetes\.io/ingress\.class"=alb \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/scheme"=internet-facing \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=$(terraform -chdir=../infra/terraform/app-infra output -raw acm_certificate_arn) \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/target-type"=ip \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/listen-ports"='[{"HTTP": 80}\, {"HTTPS": 443}]' \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/ssl-redirect"=443 \
  --set-json 'ingress.hosts=[{"host":"<your-domain>","paths":[{"path":"/auth","pathType":"Prefix"},{"path":"/user","pathType":"Prefix"},{"path":"/post","pathType":"Prefix"},{"path":"/comment","pathType":"Prefix"},{"path":"/file","pathType":"Prefix"},{"path":"/upload","pathType":"Prefix"},{"path":"/audit-log","pathType":"Prefix"},{"path":"/","pathType":"Prefix","service":"frontend"},{"path":"/admin","pathType":"Prefix","service":"admin"}]}]'
```

The last two annotations are what actually forces the HTTP→HTTPS redirect (found missing
from this recipe in a 2026-09-13 review): without an explicit `listen-ports`, the ALB
Controller never opens the port-80 listener `ssl-redirect` needs to redirect *from*, so the
two have to be set together, not `ssl-redirect` alone. The `hosts` override is
`--set-json`, not `--set ingress.hosts[0].host=<your-domain>` as this recipe used to read —
also found and fixed in that same 2026-09-13 review: `--set` on an array index replaces the
whole element rather than merging into it, so a bare `.host` override silently rendered an
`Ingress` with a real host and **zero paths** (verified by rendering it), exactly the
"routing rules quietly vanish" failure ADR 0058 exists to prevent. `--set-json` supplies the
full `hosts[0]` object — host, the complete ADR 0058 path list, the ADR 0060 `/` frontend rule, and the ADR 0062 `/admin` admin rule together — in one write. Leave the frontend rule out and the SPA silently disappears while the API keeps working; leave the admin rule out and `/admin` falls through to the frontend's `/` rule, so the console never loads.

For a checked-in, repeatable version of this instead of retyping `--set` flags on the
command line, `k8s/helm/values-prod.yaml` carries the equivalent config (host, the full
ADR 0058 path list, and these same annotations) as a commented-out template — see
`k8s/helm/README.md`'s "Enabling HTTPS (Ingress)" section.

What this actually does, end to end: the `Ingress` object this creates only *carries* the
ACM certificate ARN as an annotation — it does not itself provision anything in AWS. The
ALB Controller (running in-cluster, installed by `addons/`) watches for `Ingress` objects
with `ingressClassName: alb`, reads that annotation, and calls the AWS API directly to
create a real ALB with the certificate already attached to its HTTPS listener — one step,
not "create the ALB, then separately attach the cert." That AWS API call *is* the
deployment of the load balancer; nothing further happens on "AWS's side" as a separate
step. From then on, at runtime, a user's browser connects to that ALB over HTTPS; ALB → Service → pod
stays plain HTTP inside the cluster's private network, per ADR 0034's trust boundary.

**The DNS record** ([ADR 0063](../../../docs/ADR/0063-alb-dns-externaldns-and-delegation-set.md)).
Nothing in Terraform creates the record that points the domain at that ALB — ExternalDNS
does, installed by `addons/`. It watches `Ingress` hosts and, for a host inside the zone
(its `domainFilters` is the zone's name), creates an ALIAS record to the ALB plus TXT
ownership records; `policy: sync` removes them again when the `Ingress` goes away. So the
`Ingress` host must be `var.domain_name` or a name under it, which the `--set-json` `hosts`
above already does. It polls (`interval: 1m`), so allow a few minutes after the ALB appears.
To check (you run it; use the zone ID without the `/hostedzone/` prefix):

```sh
aws route53 list-hosted-zones-by-name --dns-name <your-domain> \
  --query 'HostedZones[0].Id' --output text
aws route53 list-resource-record-sets --hosted-zone-id <that Id, without /hostedzone/> \
  --query 'ResourceRecordSets[].[Name,Type,AliasTarget.DNSName]' --output table
```

Expect an alias `A` record for the domain pointing at the ALB's DNS name, plus `TXT` records
carrying `external-dns/owner=<cluster name>`. None of this has been observed against a live
cluster yet (ADR 0063 Consequences lists what is still open).

## What each state provisions

| State | Resource | Purpose | ADR 0043 decision |
|---|---|---|---|
| `cluster/` | `module.vpc` | VPC, public/private subnets, single NAT gateway | Unchanged from the original scaffold |
| `cluster/` | `module.eks` | EKS cluster, two heterogeneous managed node groups (`graviton` primary, `x64` idle fallback) | D3 |
| `app-infra/` | `aws_db_instance.db` | RDS PostgreSQL, private subnets, reachable only from EKS nodes on 5432 | D2 |
| `app-infra/` | `aws_s3_bucket.app` + IRSA role | Private bucket for `STORAGE_DRIVER=s3`, app pod's S3 credentials | D8 |
| `app-infra/` | `aws_secretsmanager_secret.app` | The four values the Helm chart's `secrets.existingSecret` needs | D7 |
| `app-infra/` | `aws_route53_zone.app` + `aws_acm_certificate.app` | DNS zone and DNS-validated TLS certificate for the ALB ingress; the zone can take a reusable delegation set and has `force_destroy = true` | D4, D5; [ADR 0063](../../../docs/ADR/0063-alb-dns-externaldns-and-delegation-set.md) D3, D4 |
| `addons/` | `module.eks_blueprints_addons` | AWS Load Balancer Controller + External Secrets Operator (both via the module's built-in flags) | D6, D7, D9 |
| `addons/` | ExternalDNS (`enable_external_dns`, same module) | Creates and removes the ALB's DNS record from `Ingress` hosts, scoped to the `app-infra/` zone | [ADR 0063](../../../docs/ADR/0063-alb-dns-externaldns-and-delegation-set.md) D1–D3 |

**Removed from the original scaffold, not kept commented out** (D6): the
`istio-system` namespace, the `istio-base`/`istiod`/`istio-ingress` Helm
releases, and the Istio-specific node security group rules (ports
15017/15012). Istio is planned as its own dedicated Terraform change later
(ROADMAP.md) — re-deriving it against whatever this module looks like by
then is cheaper than trying to keep dead commented-out code in sync until it
is needed.

## Destroy

Reverse of the apply order: `addons/` first, then `app-infra/`, then
`cluster/` — each state's `terraform destroy` only plans against the
resources it owns, but `app-infra/` and `addons/` still hold live
`terraform_remote_state` reads of `cluster/`'s outputs, so destroying
`cluster/` first would leave them reading a state file for resources that no
longer exist.

The AWS Load Balancer Controller add-on asynchronously reconciles resource
deletions. If the ALB ingress was ever enabled, `terraform destroy` inside
`addons/` (or, if the ALB outlived it, `cluster/`) can time out with a VPC
`DependencyViolation` error the same way the original Istio example did —
the ALB's security groups can outlive the command. Uninstall the Helm
release first, confirm the ALB and its security groups are gone in the AWS
console, then destroy in the order above. Check the actual release name —
it need not match the chart name `sharenpo` used in the examples on this
page (`deploy.sh` installs under `sharenpo` by default and the app's IRSA trust policy needs
that name; the 2026-08 deployment, since torn down, was called `upload-board`):

```sh
helm list -A
helm uninstall <release-name> -n <namespace>
```

The zone in `app-infra/` has `force_destroy = true` ([ADR 0063](../../../docs/ADR/0063-alb-dns-externaldns-and-delegation-set.md)
D3), so its `destroy` also removes records Terraform does not know about — the ALIAS and TXT
records ExternalDNS made. Uninstalling the Helm release first lets ExternalDNS's `policy: sync`
remove them on its own within a minute or so, but the destroy no longer depends on that. A
reusable delegation set, if you use one, is in no state and survives all three destroys; it
stays until you delete it by hand, which AWS allows only when no zone uses it.

`app-infra/`'s `s3_bucket_name`/`domain_name` have no default (a globally
unique bucket/domain name can't have a safe one), so its `destroy` needs the
same `-var` flags its `apply` did. Don't hardcode them into a command you
save — read the live values from the state itself right before destroying,
since they can change between deploys (e.g. a bucket recreated under a new
name):

```sh
cd app-infra
terraform output -raw s3_bucket_name                        # -> bucket name
terraform state show aws_route53_zone.app | grep '  name '  # -> domain name
```

### Step by step (reviews each plan)

Matches `deploy.sh`'s own stance of never skipping the interactive plan
review ([ADR 0046](../../../docs/ADR/0046-deploy-sequence-automation.md) D3):

```sh
cd addons
terraform destroy -var="tfstate_bucket_name=<tfstate-bucket-name>"

cd ../app-infra
terraform destroy \
  -var="s3_bucket_name=<value from above>" \
  -var="domain_name=<value from above>" \
  -var="tfstate_bucket_name=<tfstate-bucket-name>"

cd ../cluster
terraform destroy
```

### One command per state, no review (`-auto-approve`)

Skips the plan review the step-by-step form above (and `deploy.sh`'s own
apply automation) deliberately keeps. Real, billed AWS resources are
deleted the instant each command runs, with no confirmation prompt and no
snapshot (`app-infra/`'s RDS instance has `skip_final_snapshot = true`) —
use this only once you've already reviewed what each state holds (e.g. from
a prior `plan`) and just want to skip re-confirming interactively:

```sh
cd addons       && terraform destroy -auto-approve -var="tfstate_bucket_name=<tfstate-bucket-name>"
cd ../app-infra && terraform destroy -auto-approve \
  -var="s3_bucket_name=<value from above>" \
  -var="domain_name=<value from above>" \
  -var="tfstate_bucket_name=<tfstate-bucket-name>"
cd ../cluster   && terraform destroy -auto-approve
```

Destroying only `cluster/` while keeping `app-infra/` (RDS data, Route53
zone, Secrets Manager) is the concrete capability this three-state split
exists to provide (ADR 0044) — stop paying for EKS/node groups without
losing the database or the DNS setup. `addons/` must still come down first
in that case, since it depends on `cluster/`'s outputs.

To redeploy after destroying all three states, see [Deploy](#deploy) above —
the same order and `deploy.sh all` apply unchanged.

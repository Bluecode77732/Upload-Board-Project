# upload-board-project (Terraform)

> 한국어: [README.ko.md](README.ko.md)

Provisions the AWS infrastructure this repo's Helm chart (`k8s/helm/`) deploys
onto: an EKS cluster, RDS PostgreSQL, an S3 bucket, the ESO/IRSA secrets
pipeline, and an ALB-fronted, ACM-certificated ingress path. See
[ADR 0043](../../docs/ADR/0043-terraform-project-adaptation.md) for why each
resource exists and the alternatives that were rejected;
[ADR 0038](../../docs/ADR/0038-terraform-iac-scaffold.md) for this
directory's scaffold history;
[ADR 0044](../../docs/ADR/0044-terraform-three-state-split.md) for why the
configuration below is split into three independently-appliable states
instead of one root module.

**Status**: `terraform validate` and `terraform fmt -check` pass in all three
state directories. **Not yet applied against real AWS** — no `terraform
apply` has been run for this config. Applying it creates real, billed AWS
resources (EKS control plane, RDS instance, NAT Gateway, ALB) that keep
costing money until destroyed (ADR 0043 D1).

## Three states, one apply order

```
k8s/infra/terraform/
├── cluster/       module.vpc + module.eks
├── app-infra/      RDS + S3/IRSA + Secrets Manager + Route53/ACM
└── addons/         module.eks_blueprints_addons (ALB Controller + ESO)
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
   connection details from `cluster/`, and the Secrets Manager ARN from
   `app-infra/` (`external_secrets_secrets_manager_arns`). This is why it
   cannot run before `app-infra/` exists.

`terraform_remote_state` in `app-infra/` and `addons/` uses `backend =
"local"` with a relative path to the producing state's directory
(`../cluster/terraform.tfstate`, etc.) — this is a single-developer
convenience, not a shared/CI backend (ADR 0044 D3). Run every command below
from inside the directory it's shown under; `terraform init` must be run
separately in each of the three.

## Before you `apply` anything

1. **A domain you can point DNS at.** `app-infra/` creates a Route53 hosted
   zone for `var.domain_name` and DNS-validates an ACM certificate against
   it, but does **not** register or purchase the domain itself (ADR 0043
   D5) — that is an interactive, non-idempotent action outside Terraform's
   model. Buy the domain first (Route53 Domains or any registrar), then
   either delegate it to the zone this config creates (point your
   registrar's nameservers at the `route53_zone_name_servers` output) or run
   `apply` once first just to get that output, then delegate.
2. **A globally-unique S3 bucket name** for `app-infra/`'s
   `var.s3_bucket_name` — bucket names collide across all AWS accounts, not
   just yours.
3. **AWS credentials** with permission to create EKS/RDS/S3/IAM/Route53/ACM
   resources, and the `aws`/`kubectl`/`helm` CLIs installed locally (the
   `kubernetes`/`helm` providers in `addons/` shell out to `aws eks
   get-token`).
4. **`region`/`cluster_name` must match across all three `.tfvars`/`-var`
   invocations.** These are plain variables, not shared via
   `terraform_remote_state` — passing a different `cluster_name` to
   `app-infra/` than you did to `cluster/` produces a config that plans
   successfully but names/tags resources inconsistently.

## Deploy

```sh
# 1. cluster/
cd cluster
terraform init
terraform apply

# 2. app-infra/ — reads cluster/'s state via terraform_remote_state
cd ../app-infra
terraform init
terraform apply \
  -var="s3_bucket_name=<globally-unique-bucket-name>" \
  -var="domain_name=<your-domain>"

# 3. addons/ — reads both cluster/'s and app-infra/'s state
cd ../addons
terraform init
terraform apply
```

No variable in any of the three states accepts a secret value — the four
values the Helm chart's `secrets.existingSecret` needs (`DB_USERNAME`,
`DB_PASSWORD`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`) are generated
by `app-infra/` (`random_password`) and only ever live in AWS Secrets
Manager and that state's Terraform state file (ADR 0043 D7/D8).

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
   helm install upload-board . \
     --set secrets.existingSecret=$(terraform -chdir=../infra/terraform/app-infra output -raw app_secret_k8s_name) \
     --set env.DB_HOST=$(terraform -chdir=../infra/terraform/app-infra output -raw db_host) \
     --set env.DB_DATABASE=$(terraform -chdir=../infra/terraform/app-infra output -raw db_name) \
     --set env.STORAGE_DRIVER=s3 \
     --set env.S3_BUCKET=$(terraform -chdir=../infra/terraform/app-infra output -raw s3_bucket_name) \
     --set env.AWS_REGION=<same value as var.region> \
     --set env.BASE_URL=https://<your-domain>
   ```

## Known gap: the app's S3 IRSA role is scoped to `default`, not a dedicated ServiceAccount

`app-infra/`'s `aws_iam_role.app` (output as `app_iam_role_arn`) is the IRSA
role that lets the app pod's AWS SDK client resolve S3 credentials once
`STORAGE_DRIVER=s3` is set (ADR 0029, ADR 0043 D8). Its trust policy targets
`system:serviceaccount:default:default` because the Helm chart
(`k8s/helm/`) does not yet render a dedicated `ServiceAccount` — pods run
under the namespace's `default` one. Annotating `default` with this role's
ARN grants S3 access to **every** pod in the namespace that uses it, not only
this app's pods:

```sh
cd app-infra
kubectl annotate serviceaccount default \
  eks.amazonaws.com/role-arn=$(terraform output -raw app_iam_role_arn)
```

A dedicated `ServiceAccount` template in the Helm chart (mirroring how
`ingress.yaml` is already built but disabled — ADR 0041) is a follow-up
chart task, not something this Terraform config can fix on its own.

## Enabling the ALB ingress

The Helm chart's `Ingress` template exists but is disabled by default
(`ingress.enabled: false`, ADR 0041). Once `addons/` has applied (the ALB
Controller must be running to reconcile the `Ingress` object) and
`app-infra/` has the certificate, enable it with:

```sh
helm upgrade upload-board . \
  --reuse-values \
  --set ingress.enabled=true \
  --set ingress.className=alb \
  --set ingress.annotations."kubernetes\.io/ingress\.class"=alb \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/scheme"=internet-facing \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=$(terraform -chdir=../infra/terraform/app-infra output -raw acm_certificate_arn) \
  --set ingress.hosts[0].host=<your-domain>
```

## What each state provisions

| State | Resource | Purpose | ADR 0043 decision |
|---|---|---|---|
| `cluster/` | `module.vpc` | VPC, public/private subnets, single NAT gateway | Unchanged from the original scaffold |
| `cluster/` | `module.eks` | EKS cluster, two heterogeneous managed node groups (`graviton` primary, `x64` idle fallback) | D3 |
| `app-infra/` | `aws_db_instance.db` | RDS PostgreSQL, private subnets, reachable only from EKS nodes on 5432 | D2 |
| `app-infra/` | `aws_s3_bucket.app` + IRSA role | Private bucket for `STORAGE_DRIVER=s3`, app pod's S3 credentials | D8 |
| `app-infra/` | `aws_secretsmanager_secret.app` | The four values the Helm chart's `secrets.existingSecret` needs | D7 |
| `app-infra/` | `aws_route53_zone.app` + `aws_acm_certificate.app` | DNS zone and DNS-validated TLS certificate for the ALB ingress | D4, D5 |
| `addons/` | `module.eks_blueprints_addons` | AWS Load Balancer Controller + External Secrets Operator (both via the module's built-in flags) | D6, D7, D9 |

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
release first (`helm uninstall upload-board`), confirm the ALB and its
security groups are gone in the AWS console, then destroy in the order
above.

Destroying only `cluster/` while keeping `app-infra/` (RDS data, Route53
zone, Secrets Manager) is the concrete capability this three-state split
exists to provide (ADR 0044) — stop paying for EKS/node groups without
losing the database or the DNS setup. `addons/` must still come down first
in that case, since it depends on `cluster/`'s outputs.

# ADR 0068: Deploy identifiers move out of `values-prod.yaml` into a gitignored overlay

- Status: Accepted — implemented; the rendered chart is unchanged, nothing was applied to a cluster
- Date: 2026-10-26
- Relates to: [ADR 0046](0046-deploy-sequence-automation.md) (`deploy.sh` and the `values-prod.yaml` overlay), [ADR 0041](0041-helm-chart-project-adaptation.md) (the chart)
- 한국어: [0068-deploy-identifiers-gitignored-overlay.ko.md](0068-deploy-identifiers-gitignored-overlay.ko.md)

## Context

`k8s/helm/values-prod.yaml` is tracked in a public repository and held four values that point at
one specific AWS deployment: `env.DB_HOST` (the RDS address), `env.S3_BUCKET` (its name carries the
AWS account number), the IRSA role ARN under `serviceAccount.annotations` and the ACM certificate
ARN under `ingress.annotations`. Found on 2026-10-21 while reviewing the README for secrets. None of
them is a credential; an account number or a host name does not grant access. They still say which
account and which database this project runs against, for no benefit to a reader of the repository.

`deploy.sh` passes the file straight to `helm upgrade` (`-f values-prod.yaml`), so the values cannot
simply be replaced with placeholders in place. The first decision on 2026-10-21 was to leave them
(the README listed this as a known limitation); on 2026-10-26 the developer asked for it to be done.

## Decision

### D1 — The four values live in `k8s/helm/values-prod.local.yaml`, gitignored

Helm merges maps across `-f` files, so the overlay repeats only the four keys. In
`values-prod.yaml` they are placeholders (`<AWS_ACCOUNT_ID>`, `<RDS_HOST - set in
values-prod.local.yaml>`, `<CERTIFICATE_ID>`). `.gitignore` lists the overlay.

### D2 — `deploy.sh helm` refuses to run without the overlay, and layers it after `values-prod.yaml`

The check runs first in `deploy_helm`, before the Docker Hub lookups and the y/N prompt. Without it
the script would deploy the placeholders: the pod would get a wrong DB host and an IRSA annotation
for a role that does not exist, and the failure would show up late.

### D3 — A tracked `values-prod.local.example.yaml` shows the shape and where each value comes from

It names the `terraform output` that produces each value (`db_host`, `acm_certificate_arn`, the role
`${cluster_name}-app`, and the `s3_bucket_name` passed to `apply`).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Leave the values in the file (the 2026-10-21 decision) | They are identifiers, not credentials, and are already in history. Removing them costs one extra file; the developer asked for it |
| `deploy.sh` reads `terraform output` and passes `--set` | The Helm-only path (README, "Helm only") has no Terraform state to read. The role ARN sits under an annotation key with dots, which `--set` needs escaped |
| Rewrite git history (`git filter-repo`) | Needs a force push to `main` and `dev` and breaks every other clone, for values that are not secrets. Not done |

## Consequences

- Verified with `helm template` on 2026-10-26: with `-f values-prod.yaml -f values-prod.local.yaml`
  the output is identical to the output from the file before the change (607 lines, no diff); with
  `values-prod.yaml` alone, 8 lines differ, the four placeholders. `bash -n deploy.sh` passes. Run
  with `IMAGE_TAG` set, `deploy.sh helm` stops with an error when the overlay is missing, and
  with it present stops at the prompt when answered `n` (`helm upgrade` was never run). No cluster
  was involved and nothing was applied.
- The real values remain in git history. They were not removed from it.
- Anyone who deploys needs their own `values-prod.local.yaml`. A fresh clone has none, so the first
  `deploy.sh helm` fails with the message that says how to make one.
- A bare `helm upgrade ... -f values-prod.yaml` now needs the second `-f`. The Helm README says so.
- The ADR 0046 text is left as written; this ADR is the pointer.

# ADR 0046: Deploy-sequence automation — a local shell script, Terraform + Helm only

- Status: Accepted — implemented
- Date: 2026-08-27
- Related: [ADR 0043](0043-terraform-project-adaptation.md) and
  [ADR 0044](0044-terraform-three-state-split.md) (the three-state layout this script
  drives — their resource decisions are unchanged), [ADR 0016](0016-github-actions-ci.md)
  (why this stays a local script rather than a CI workflow)
- 한국어: [0046-deploy-sequence-automation.ko.md](0046-deploy-sequence-automation.ko.md)

## Context

`docs/ROADMAP.md` §7 recorded, on 2026-08-26, that the first real end-to-end `apply` of
the `cluster` → `app-infra` → `addons` → Helm sequence surfaced eight order-dependent
failure modes a developer has to carry in their head from
`k8s/infra/terraform/README.md`'s prose: an EOL EKS
version, a missing `ami_type` for the `graviton` node group, a Free-Tier instance-type
rejection, the ACM certificate's two-phase `apply` requirement, an unbounded Route53
NS-delegation wait, a cross-region S3 bucket collision, a Helm install race between the
ALB Controller's admission webhook and External Secrets Operator's own `Service`
creation, and `eks-managed-node-group`'s `ignore_changes` silently no-opping `-var`
scaling changes. That entry deferred automating the sequence until the deployment it
came from was confirmed stable, and named the two axes needing their own decision: tool
(shell script vs. GitHub Actions vs. Makefile) and scope (infra-only vs. Helm and the
post-apply manual steps too).

`docs/ROADMAP.md` §9 (2026-08-27) now records that stabilization: the Helm release
`upload-board` reached `STATUS: deployed` (revision 5), S3 IRSA access was confirmed
working, the `graviton` node type was fixed permanently at `t4g.medium`, and
`k8s/helm/values-prod.yaml` was added collecting that deployment's `--set` flags into one
reusable overlay. The trigger condition §7 named is satisfied.

## Decision

### D1 — Tool: a plain bash shell script, not a Makefile or a CI workflow

| Criterion | Shell script | Makefile | GitHub Actions (manual dispatch) |
|---|---|---|---|
| Precedent in this repo | `build-and-push.sh` — an existing human-run local script for exactly this class of task (multi-arch image build/push) | None | CI (`.github/workflows/ci.yml`, ADR 0016) runs lint/test/build only, never a deploy |
| Interactive human-confirmation gate | Natural (`read -p`) | Awkward — `make`'s model is non-interactive by convention | Possible via environment protection rules, but adds real workflow complexity for a single-developer repo |
| Consistent with "no CD pipeline" | Yes — still a locally-triggered tool | Yes | No — a workflow that applies infrastructure or upgrades a Helm release **is** a deploy pipeline; adding one here would reverse `CLAUDE.md`'s CI/CD section without that being its own decision |
| Billed-resource risk | Low (local, human-triggered every run) | Low | Higher — even a manual-dispatch workflow tends toward "run it and forget it," and secrets/credentials would need to live in GitHub |

Chosen: **a shell script**, `k8s/infra/terraform/deploy.sh`, run by hand exactly like
`build-and-push.sh` already is. This keeps the "no automated deploy pipeline (CD)"
statement in `CLAUDE.md` > CI/CD true — automating the *sequence* a human runs is not the
same decision as automating *when* it runs, and only the former was asked for here.

### D2 — Scope: Terraform 3-state sequencing + Helm install/upgrade, not the one-time manual steps

| Criterion | Terraform-only | **Terraform + Helm** | + one-time manual steps (ESO sync, SA annotation) |
|---|---|---|---|
| Covers §7's actual recorded failures | Partial — the Helm/ALB-webhook race is one of the eight and sits in the Helm step, not Terraform | Yes — covers the ACM two-phase apply, the 3-state order, and the Helm-stage race | Yes, plus the rest |
| Matches what `k8s/infra/terraform/README.md` calls one-time/interactive | — | Yes — ESO secret sync and the `default` ServiceAccount IRSA annotation are already documented as one-time steps gated on `addons`/`app-infra` outputs existing, not steps that recur on every deploy | Folds a one-time step into a repeatable script — a shape mismatch |
| Leaves Ingress untouched | Yes | Yes | Risk of scope creep toward enabling it, which is explicitly out of scope for this task |

Chosen: **Terraform 3-state sequencing + `helm upgrade --install`**, reusing
`k8s/helm/values-prod.yaml` rather than an enumerated `--set` list (the values-prod
overlay exists precisely to avoid that regression). Domain purchase/NS delegation, the
ESO secret sync (`terraform output ... | kubectl apply -f -`), the `default`
ServiceAccount IRSA annotation, and enabling the ALB `Ingress` all stay manual, exactly as
`k8s/infra/terraform/README.md` already documents them — `k8s/infra/terraform/deploy.sh
--help` names all four so a developer isn't left guessing what the script doesn't cover.

### D3 — No `-auto-approve`, ever; region/cluster_name checked against live state

Every `terraform apply` in the script follows the same shape: `terraform plan
-out=<tmpfile>` → show the plan → `read -p` for an explicit `y` → `terraform apply
<tmpfile>` (the exact saved plan; no separate re-confirmation prompt, and no way to apply
something the human didn't see). Any other answer aborts. This satisfies the task's
constraint that a script never default to unattended approval for billed resource
changes, and is stricter than a bare `-auto-approve` ban would require — a saved plan
file removes the "plan and apply drifted apart" risk a bare `terraform apply -var=...`
re-run (without `-out`) would still carry.

Before `app-infra`'s or `addons`' apply, the script reads `cluster/`'s **already-applied**
`cluster_name` output and compares it to the current invocation's `CLUSTER_NAME`, refusing
to proceed on a mismatch. This is the concrete form of
`k8s/infra/terraform/README.md`'s "Before you apply anything" #4 warning:
`region`/`cluster_name` are plain variables in all three states, not
shared via `terraform_remote_state`, so typing a different value into one state's `-var`
than another's produces a plan that succeeds while naming/tagging resources
inconsistently. Reading the live output (rather than only relying on one script run using
one consistent env var) also catches the case where `app-infra`/`addons` are invoked in a
separate script run from `cluster`, days later, with a different environment.

### D4 — ACM two-phase apply, automated

`k8s/infra/terraform/app-infra/main.tf`'s `aws_route53_record.app_cert_validation` has a
`for_each` over `aws_acm_certificate.app.domain_validation_options`, which is not known
until `aws_acm_certificate.app` exists. The script runs `terraform apply
-target=aws_acm_certificate.app` first (its own plan/confirm/apply cycle), then a full
`app-infra` apply — matching the two-phase requirement
`k8s/infra/terraform/README.md` already names, so a developer no longer needs to
remember which resource to target.

## Consequences

- New file: `k8s/infra/terraform/deploy.sh` (subcommands `cluster`, `app-infra`,
  `addons`, `helm`, `all`). No `.tf` file was changed — `terraform fmt -check` and
  `terraform validate` pass unchanged in `cluster/`, `app-infra/`, and `addons/`.
- Live-verified against the real AWS account (`074416822640`, `ap-northeast-2`):
  `deploy.sh cluster` ran an actual `terraform plan` (confirmed "No changes. Your
  infrastructure matches the configuration.") and then correctly aborted with no
  application when given no interactive confirmation — the default-deny path was
  exercised for real, not just read.
- `CLAUDE.md` > CI/CD's "no automated deploy pipeline (CD) and no git hooks" statement
  stays true: this script is a developer-run local tool, the same shape as
  `build-and-push.sh`, not a new CI/CD surface.
- Trade-off accepted: the script does not remove every manual step from a full
  first-time deploy — domain purchase/NS delegation, the ESO secret sync, the S3 IRSA
  ServiceAccount annotation, and enabling `Ingress` are still hand-run, per D2. A future
  task could fold the ESO sync and SA annotation in (both are deterministic and
  scriptable, just gated on `addons`/`app-infra` already being applied), but that is new
  scope, not something this decision does implicitly.
- `docs/ROADMAP.md` §7's "Automate the `cluster` → `app-infra` → `addons` → Helm deploy
  sequence" row is marked done, pointing here.

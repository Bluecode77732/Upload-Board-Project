# ADR 0063: ALB DNS record via ExternalDNS, and a reusable delegation set to pin the zone's name servers

- Status: Accepted — code-complete (`terraform fmt -check`/`validate` and `bash -n` pass); nothing planned or applied
- Date: 2026-09-25
- Amends: [ADR 0043](0043-terraform-project-adaptation.md) (D5's name-server step: the registrar now points at a reusable delegation set, not at whichever zone Terraform created last)
- Extends: [ADR 0044](0044-terraform-three-state-split.md) (`addons/` reads one more `app-infra/` output), [ADR 0047](0047-observability-prometheus-grafana.md) (one more `eks_blueprints_addons` module flag)
- Relates to: [ADR 0034](0034-https-termination-stance.md), [ADR 0046](0046-deploy-sequence-automation.md), [ADR 0058](0058-ingress-path-allowlist.md), [ADR 0060](0060-frontend-same-alb-path-routing.md), [ADR 0062](0062-admin-same-alb-subpath-routing.md)
- 한국어: [0063-alb-dns-externaldns-and-delegation-set.ko.md](0063-alb-dns-externaldns-and-delegation-set.ko.md)

## Context

Nothing in this repo creates the DNS record that points the domain at the ALB.
`app-infra/` creates the Route53 zone and the ACM validation records only
(`app-infra/main.tf`, the "DNS + TLS" block). The ALB itself is created later by the AWS
Load Balancer Controller once an `Ingress` exists (`k8s/infra/terraform/README.md`,
"Enabling the ALB ingress"), so its address is unknown at `apply` time, and a recreated ALB
is a new load balancer with its own DNS name. `k8s/helm/README.md`'s Pending list assumes
"the domain resolves to the ALB" without saying who makes that true.

A related cost: a hosted zone gets a new set of four name servers every time it is created
(`README.md`, "Before you `apply` anything"), and the cycle this project has used so far is a
full `apply` → verify → `destroy` (ADR 0043 D1). The domain, `sharenpo.cloud`, is registered at
an external registrar (Gabia), not Route53 Domains, so every new zone means a hand edit there.
The developer confirmed on 2026-09-25 that the domain is theirs and that its name servers can
be changed.

What the session read on 2026-09-25 before this decision — source code or official
documentation, not memory. Nothing was run against AWS.

- **eks-blueprints-addons.** `~> 1.16` resolves to the newest 1.x at `init` (the lock file pins
  providers only); `v1.16.0` and `v1.24.3` were both read. Both declare `enable_external_dns`,
  `external_dns` and `external_dns_route53_zone_arns`, default `chart_version` to `1.14.3` and
  `values` to `["provider: aws"]`, and create the IRSA role only when the zone-ARN list is
  non-empty. The role's policy grants `ChangeResourceRecordSets` and `ListTagsForResource` on
  the given zone ARNs, and `ListHostedZones` and `ListResourceRecordSets` on `*`.
- **ExternalDNS charts.** Chart `1.14.3` (published 2024-01-26) is app `0.14.0`; the newest
  chart, `1.22.0` (published 2026-09-11), is app `0.22.0`. Neither `Chart.yaml` declares a `kubeVersion`, and `cluster/main.tf`
  runs Kubernetes `1.34`. `policy` defaults to `upsert-only` in `1.14.3` and is required in
  `1.22.0`; `interval` is `1m` and `registry` is `txt` in both. Both have `resources: {}`.
- **ExternalDNS behavior.** Its docs say an Ingress' load-balancer hostname becomes a Route53
  ALIAS record, at the zone apex too. The AWS provider at `v0.22.0` has that path
  (`AliasTarget`, `useAlias`). Its `ListTagsForResources` call (the singular form in `v0.14.0`)
  runs only when a zone-tag filter is set; this design sets none.
- **ExternalDNS image.** The chart's image tag defaults to `v` + its `appVersion`, so `1.22.0`
  runs `registry.k8s.io/external-dns/external-dns:v0.22.0`, whose registry index lists
  `linux/amd64`, `linux/arm64` and `linux/arm` (read 2026-09-26) — the only nodes that run in the
  cluster are `arm64`.
- **Terraform.** `aws_route53_zone.force_destroy` exists in provider `5.100.0`: "destroy all
  records (possibly managed outside of Terraform) in the zone when destroying the zone".
- **Reusable delegation sets** (the API model shipped with the AWS CLI). A set is four name
  servers reusable by several zones. Creating one takes no name-server input — only
  `CallerReference` and an optional `HostedZoneId`, which reuses that existing zone's four. A
  set can be deleted only when no zone uses it. The provider stores the ID without the
  `/delegationset/` prefix and passes the configured value as-is on create (`zone.go`).
- **Cost.** The Route53 Price List (version `20260911124504`) has no API-request item and no
  delegation-set item. AWS's IAM docs say IAM and STS are offered at no additional charge, and
  the pricing page says alias queries to ELB are free. No page states "API calls are free" in
  so many words.

## Decision

### D1 — ExternalDNS, enabled through the module flag in `addons/`

`addons/main.tf` sets `enable_external_dns = true` and
`external_dns_route53_zone_arns = [<zone ARN>]` on `module.eks_blueprints_addons`. `addons/`
already reads `app-infra/`'s state (ADR 0044 D2); `app-infra/` gains two outputs,
`route53_zone_arn` and `route53_zone_name`. ExternalDNS then watches Ingress hosts and creates
and removes the ALIAS record plus its TXT ownership records in that zone. The module creates the
IRSA role scoped to that one zone (namespace `external-dns`, service account `external-dns-sa`
by default) — the same mechanism the ALB Controller, ESO and kube-prometheus-stack already use
in this state.

### D2 — Chart pinned to `1.22.0`; values kept minimal

`external_dns.chart_version = "1.22.0"` instead of the module's `1.14.3`, which is eight minors
behind and predates Kubernetes `1.34`. Passing `external_dns.values` replaces the module's
default `["provider: aws"]`; both charts already default `provider.name` to `aws`, so the values
carry only `policy: sync`, `txtOwnerId` (the cluster name), `domainFilters: [<route53_zone_name>]`
and `sources: [ingress]`, plus `service.enabled: false`. The first four keys exist in both charts'
`values.yaml`. `service.enabled` exists only in `1.22.0` (in `1.14.3` the Service is
unconditional); it turns off the chart's metrics Service, which nothing here scrapes, and with it
a known failure mode: a Service created while the ALB Controller's admission webhook is not yet
ready failed once for External Secrets (`k8s/infra/terraform/README.md`, "Cleaning up after a
failed apply"), and ExternalDNS installs in the same `apply` as that controller. The rendered
values are in `addons/main.tf`.

### D3 — Deletion: `policy: sync` and zone `force_destroy = true`, both

`sync` makes ExternalDNS remove the records it owns when the Ingress goes away. It is not enough
alone: it runs on the `1m` interval and only while ExternalDNS is still up, and
`terraform destroy` of the zone fails while records the state does not know about remain.
`force_destroy = true` on `aws_route53_zone.app` makes the zone's destroy independent of that
timing. The cost is that any record in the zone is deleted with it; this zone belongs to this app
alone. (`upsert-only`, `1.14.3`'s default, would never delete and would leave every teardown
depending on `force_destroy`.)

### D4 — Name servers pinned with a reusable delegation set created outside Terraform

The set is created once by hand (`aws route53 create-reusable-delegation-set`, run by the
developer), its four name servers are put at the registrar once, and `app-infra/` takes the set's
ID through a new optional variable, `delegation_set_id` (`default = null`), passed to
`aws_route53_zone.app`. Every zone created afterwards gets the same four name servers, so the
registrar edit does not repeat, and the first `apply` no longer pauses mid-run for ACM validation
to wait on the registrar (this follows from the README's description of the wait; it has not been
run).

- **Outside Terraform on purpose.** An `aws_route53_delegation_set` resource would be destroyed
  with the `app-infra/` state and the name servers would change again.
- **No choosing the name servers.** The API takes none, and the previous zone no longer exists to
  reuse (`HostedZoneId`), so the registrar edit happens once, to the new set's servers.
- **The ID goes in without the `/delegationset/` prefix** the CLI prints, matching what the
  provider stores.
- **`deploy.sh` must pass it.** Its `app-infra` plan/apply already passes `-var="domain_name=..."`
  at four places; without a matching `-var="delegation_set_id=..."` the pinning is silently
  skipped, and its mid-apply "fetch the new name servers" messages become wrong. It now reads an
  optional `DELEGATION_SET_ID` and passes it at all four. When `plan` and `apply` are run
  separately, both runs need the same value: the first `app-infra` step comes from the saved plan,
  but the second is planned fresh, and without the value it would show the zone's
  `delegation_set_id` going back to null.

### D5 — Scope

This ADR does not apply anything, create a record, or touch the registrar. Enabling the Ingress
stays Helm-side (ADR 0041, 0058, 0060, 0062). Implementation (Terraform, `deploy.sh`, READMEs)
lands after the file list is approved.

## Alternatives rejected

Each entry says what the alternative did better, since that is the trade-off accepted.

- **A — a hand-made Alias record.** Zero new dependencies and the project's existing shape for
  what Terraform cannot converge (ADR 0043 D5, the ESO manifest). Not chosen: it is one manual
  step per deploy cycle, since a recreated ALB has a new address, and a leftover record blocks the
  zone's destroy unless `force_destroy` is set anyway. The developer expects repeated full
  `apply`/`destroy` cycles.
- **B — a Terraform-managed record.** Declarative and tracked in state, no in-cluster component.
  Not chosen: the ALB does not exist at plan time, so a `data "aws_lb"` lookup needs a gate
  variable and a second `apply` after Helm, which breaks the linear `cluster` → `app-infra` →
  `addons` order (ADR 0044) — or a fourth state, which amends ADR 0044. Destroy order would need
  the gate switched off first (an inference, not reproduced). `alb.ingress.kubernetes.io/load-balancer-name`
  could make the name deterministic (32 characters at most, honored only at creation), but that
  does not remove the ordering problem.
- **A Terraform `aws_route53_delegation_set` resource for the pinning.** Fully declarative. Not
  chosen: it shares the state's lifetime, which defeats the pinning (D4).
- **Keeping the module's default chart `1.14.3`.** Fewer changes to reason about. Not chosen: a
  2024 chart against Kubernetes `1.34`, with nothing declared about compatibility.
- **A hand-written `helm_release` and IAM role for ExternalDNS.** Full control over values. Not
  chosen: the module flag already builds the release and the zone-scoped IRSA role, as it does
  for ESO (ADR 0043 D7).
- **Keeping the zone alive across teardowns** (its own state, apart from RDS). This is the usual
  practice, and it would make the delegation set unnecessary. Not chosen here: it is a structural
  change to ADR 0044's split and outside this task. It remains open.

## Consequences

- **Money.** ExternalDNS adds no AWS charge that the sources above show. The zone's
  $0.50/month exists regardless. The pod reserves nothing (`resources: {}`); its real usage is
  not measured. "No charge for API calls" is inferred from the price list having no such item,
  not from a statement.
- **Files changed:** `app-infra/variables.tf` (the variable rejects a `/delegationset/`-prefixed
  value), `main.tf`, `outputs.tf`; `addons/main.tf`; `deploy.sh`; `k8s/infra/terraform/README.md`
  and `k8s/helm/README.md` (both with `.ko.md`); `docs/ADR/README.md` and `README.ko.md`.
  `CLAUDE.md`'s Terraform entry (`addons/` = ALB Controller + ESO, `app-infra/`'s contents) needs
  a follow-up sync.
- **Verified by the session, 2026-09-25:** `terraform init -backend=false`, `fmt -check` and
  `validate` pass in `app-infra/` and `addons/`. The `delegation_set_id` validation was run in an
  isolated config: unset and a bare ID are accepted, a `/delegationset/`-prefixed one is rejected.
  `bash -n deploy.sh` passes, and the unquoted `-var` expansion drops out when empty and becomes
  one argument when set. No `plan` or `apply` — there is no state bucket to plan against.
- **Live-only, not yet observed** (developer runs, session records what is reported):
  1. After the Ingress is enabled, `aws route53 list-resource-record-sets` shows the ALIAS
     record for the host pointing at the ALB, plus TXT ownership records, within a few intervals.
  2. `curl -I http://<domain>` redirects to HTTPS.
  3. After `helm uninstall`, the records are removed, or `force_destroy` clears them, and the
     `app-infra/` destroy completes.
  4. Chart `1.22.0` installs next to the ALB Controller without the Service-webhook failure
     (`service.enabled: false` is meant to prevent it) and runs on EKS `1.34` — it was two weeks
     old when chosen.
  5. A second zone created with `delegation_set_id` gets the same name servers, and `plan` on a
     later apply shows no zone replacement.
- **Adding a zone-tag filter later** needs an extra IAM statement for `ListTagsForResources`
  (plural) through `external_dns.policy_statements`; the module's policy grants only the singular.
- **Revisit `sync`** (D3) if the app ever serves real users: an accidental Ingress removal would
  then delete its records.
- `init` resolved `eks-blueprints-addons` to `1.24.3` on 2026-09-25, the version whose
  `external_dns` block was read. The lock file does not pin modules, so a later `init` can pick a
  newer 1.x; re-read that block if it resolves something much newer.

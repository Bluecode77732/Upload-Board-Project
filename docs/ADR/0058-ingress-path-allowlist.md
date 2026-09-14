# ADR 0058: Ingress path allow-list — closing off health, metrics, and docs

- Status: Accepted — implemented, `helm template`/`helm lint`-verified
- Date: 2026-09-13
- Extends: [ADR 0041](0041-helm-chart-project-adaptation.md)
- 한국어: [0058-ingress-path-allowlist.ko.md](0058-ingress-path-allowlist.ko.md)

## Context

A 2026-09-09 security review found `k8s/helm/templates/ingress.yaml`'s only
path rule was a single catch-all `path: /` (`pathType: ImplementationSpecific`).
The moment `ingress.enabled` is ever flipped to `true` (still `false`
everywhere today — ROADMAP.md: deferred until an external tester actually
needs it), that one rule would route every path through the public ALB with
no exceptions, including `/health/live`, `/health/ready`, `/metrics`, and
`/doc` (Swagger UI) — none of which carry any authentication (`HealthModule`
and `MetricsModule` are deliberately unauthenticated, ADR 0031/0047; Swagger's
own controller has no guard).

Two things settled during discussion narrowed this to a concrete decision:

- **`/health/*` and `/metrics` never need to be reachable through Ingress at
  all.** kubelet's liveness/readiness probes hit the pod directly by IP, and
  Prometheus's `ServiceMonitor` (ADR 0047) scrapes the Service/pod endpoints
  directly — neither consumer's traffic passes through Ingress in the first
  place. Closing these off costs nothing operationally.
- **`/doc` was a genuine trade-off, not a clear-cut case.** The stated reason
  to keep it public was letting an external reviewer browse the API
  live — but in practice, portfolio/interview review happens mostly through
  reading the repo (README, code) or a live screen-shared demo, rarely by an
  interviewer independently discovering and browsing a public Swagger URL
  unprompted. Weighed against that thin benefit, `/doc` carries the same
  "no auth gate" risk profile as `/health`/`/metrics` — it hands anyone who
  finds the URL a complete map of every endpoint, parameter, and DTO shape.
  The decision (developer, this session): close it too. Internal use (local
  dev, cluster-internal access) is unaffected.

## Decision

### D1 — Explicit allow-list of controller prefixes, not a narrower catch-all

`values.yaml`'s `ingress.hosts[].paths` now lists exactly the app's real
`@Controller` prefixes: `/auth`, `/user`, `/post`, `/comment`, `/file`,
`/upload`, `/audit-log`. `/health`, `/metrics`, and `/doc` are excluded by
omission. `/audit-log` is admin-only (`RolesGuard`), but that's true of parts
of `/user`/`/post` too — the criterion for this list isn't "is it
authenticated," it's "does it have an auth gate at all." Every listed prefix
already sits behind `JwtAuthGuard` (and `RolesGuard` where applicable), so
Ingress-level exposure adds no incremental risk for them; the three excluded
paths are the only ones with no gate of their own, making the network layer
their only protection.

### D2 — Allow-list over an ALB-specific reject rule

Two implementation shapes were compared:

- **A — ALB fixed-response reject rule**: keep the `/` catch-all, add
  higher-priority path rules for `/health`/`/metrics`/`/doc` pointing at a
  `alb.ingress.kubernetes.io/actions.<name>` fixed-response backend
  (`{"type":"fixed-response",...}`, service name = action name,
  `port: use-annotation`).
- **B — rewrite `/` into an explicit allow-list** (chosen): no catch-all at
  all; only the named prefixes route anywhere.

B was chosen for four reasons:

1. **Consistency with this codebase's existing posture.** The global
   `ValidationPipe` runs `whitelist + forbidNonWhitelisted`, and
   `backend/entities.ts` is a single explicit registration list rather than a
   glob — both are "declared-only" designs. B is the same philosophy applied
   at the Ingress layer; A would be the one place in this project defaulting
   new surfaces to *open* instead.
2. **Controller portability.** `addons/main.tf` has
   `enable_aws_load_balancer_controller = true`, but the chart itself has
   never committed to it (`ingress.className` is still `""`). A's annotation
   syntax is ALB-specific; B renders identical rules under any ingress
   controller.
3. **Verifiability, given nothing is deployed.** All three Terraform states
   were destroyed 2026-08-28 (CLAUDE.md's Terraform/infra entry) — there is
   no live ALB to test A's reject rule against. That matters because rule
   *priority* is exactly what A depends on, and the AWS Load Balancer
   Controller has open, unresolved reports of not always honoring path/rule
   order reliably
   ([kubernetes-sigs/aws-load-balancer-controller#3033](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/3033),
   [#2203](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/2203)).
   Shipping a security control whose correctness rests on an unverifiable,
   controller-specific ordering guarantee was rejected. B has no ordering
   dependency to verify — a prefix either appears in the list or it doesn't,
   checkable by reading rendered YAML alone.
4. **Template cost.** A requires new conditional logic in `ingress.yaml`
   (a per-path backend-service override for the fixed-response target); B
   needed zero template changes — confirmed by rendering both against the
   current template unchanged (see Verification).

Accepted cost of B: a future new controller's route must be added to this
list to be externally reachable, or it 404s by default. This is treated as
the correct default (fail closed on new surfaces), not a gap — and it's the
same manual-registration discipline this project already requires elsewhere
(`entities.ts`, `test/e2e-utils.ts`'s `MIGRATIONS`/`TABLES`).

### D3 — `pathType: Prefix`, not the scaffold's `ImplementationSpecific`

The original chart scaffold used `ImplementationSpecific` because no concrete
routing intent existed yet (a placeholder `path: /`). Now that the paths name
real prefixes meant to match their own sub-paths (`/file` should also match
`/file/123/content`), `Prefix` is the correct standard Kubernetes pathType —
portable across any ingress controller, with no controller-specific
interpretation left to resolve.

### D4 — `values-prod.yaml` is untouched; the Helm array-merge gotcha is
documented instead

`values-prod.yaml` declares no `ingress` key today — Ingress stays disabled
there exactly as in the base chart, since turning it on for real (host, TLS,
ALB annotations) is still deferred to whenever an external-tester need
actually materializes (ROADMAP.md). This task only changes the base
`values.yaml` allow-list; it does not add a placeholder `ingress` block to
`values-prod.yaml` for a feature not yet in use there.

One thing worth recording for whoever does turn it on later: Helm does not
merge arrays across `-f` layers — it replaces them wholesale. A future
`values-prod.yaml` that overrides only `ingress.hosts[].host` (the real
domain) without repeating `paths` would silently render an Ingress with a
host and zero rules under it. This is now called out directly in
`values.yaml`'s `ingress` comment block, next to where the allow-list itself
lives.

## Verification

No live cluster exists to test against (all three Terraform states destroyed
2026-08-28). Because this change is pure Kubernetes-spec-level Ingress data
(no controller-specific annotation whose runtime behavior needs proving —
unlike option A would have needed), `helm template`/`helm lint` are actually
sufficient here, not a stand-in for missing live verification:

- `helm lint k8s/helm --set secrets.existingSecret=dummy-secret` — 0 failures.
- `helm template sharenpo k8s/helm --set ingress.enabled=true --set
  secrets.existingSecret=dummy-secret --show-only templates/ingress.yaml` —
  renders exactly the seven allow-listed paths (`/auth`, `/user`, `/post`,
  `/comment`, `/file`, `/upload`, `/audit-log`), each routed to this chart's
  own Service; `/health`, `/metrics`, `/doc` do not appear. `templates/
  ingress.yaml` required zero changes, confirming D2's template-cost claim.

## Consequences

- `k8s/helm/values.yaml`'s `ingress.hosts[].paths` changed from one
  `path: /` (`ImplementationSpecific`) to seven explicit prefixes
  (`Prefix`). `templates/ingress.yaml` is unchanged.
- `ingress.enabled` stays `false` — this task doesn't turn Ingress on, only
  prepares its shape for whenever it is.
- `/doc` (Swagger UI) is no longer reachable externally once Ingress is ever
  enabled; internal/local access (`localhost:3000/doc`, or from inside the
  cluster) is unaffected. If a future need for public API-doc browsing is
  confirmed, revisit as its own decision rather than reopening this one.
- A future new controller must have its path prefix added to this allow-list
  to be externally reachable — a manual step, same class as `entities.ts`
  registration.
- `values-prod.yaml` is unchanged; whoever enables Ingress for real must
  redeclare the full `paths` list there too (Helm doesn't merge arrays,
  documented in `values.yaml`'s comment) alongside the real host/TLS/ALB
  annotations.

### Addendum (2026-09-13) — the values-prod.yaml template landed

The gap above is now partly closed: `k8s/helm/values-prod.yaml` carries a fully
commented-out `ingress` block with the real host, this ADR's seven-path list
redeclared in full, and the `certificate-arn`/`listen-ports`/`ssl-redirect`
annotations — ready to uncomment once `addons/` and `app-infra/` are re-applied.
`ingress.enabled` stays `false`; nothing here changes that. Verifying the
template (`helm lint`/`helm template --set ingress.enabled=true ...`) also
surfaced a real bug in `k8s/infra/terraform/README.md`'s existing `helm
upgrade --set ingress.hosts[0].host=...` one-liner: `--set` on an array index
replaces the whole element, silently dropping every path in this ADR's
allow-list — exactly what this ADR exists to prevent. Fixed there with
`--set-json` for the full `hosts` array instead.

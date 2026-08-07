# ADR 0034: HTTPS Termination Happens at the Ingress, Not in the App (Design Only)

- Status: Accepted (design-only — no code change)
- Date: 2026-08-08
- Amends: [ADR 0015](0015-docker-and-compose.md) (Consequences flagged "no...
  HTTPS" as deferred production hardening)
- Relates to: [ADR 0012](0012-refresh-cookie-rotation.md) (the refresh cookie's
  `Secure` flag, gated by `ENV === 'prod'`, requires the connection the browser
  sees to actually be HTTPS)
- 한국어: [0034-https-termination-stance.ko.md](0034-https-termination-stance.ko.md)

## Context

The refresh-token cookie (`backend/auth/auth.controller.ts`,
`refreshCookieBaseOptions`) already sets `secure: true` whenever
`ConfigService.getOrThrow('ENV') === 'prod'`. That flag is correct only if the
browser's actual connection to whatever it thinks is this API is HTTPS — a
`Secure` cookie over a connection the browser sees as plain HTTP is simply
dropped, silently breaking refresh/rotation in prod. Today's Node process
listens on plain HTTP (`app.listen`, `main.ts`) and nothing terminates TLS in
front of it. This has been a live gap since ADR 0012, latent only because
nothing has been deployed with `ENV=prod` yet.

## Decision

- **TLS termination happens at the ingress/load-balancer layer, never inside
  the Node process.** In the target AWS + Kubernetes shape (ROADMAP.md >
  Stage 4), that is a Kubernetes `Ingress` (or an AWS ALB via the AWS Load
  Balancer Controller) holding the certificate (ACM-issued, or cert-manager +
  Let's Encrypt) and forwarding plain HTTP to the pod. This is the standard
  cloud-native split: one termination point per cluster/service instead of
  every workload carrying its own certificate and renewal logic.
- **No code change lands with this ADR.** `main.ts` keeps listening on plain
  HTTP; the existing `secure: ENV === 'prod'` gate in
  `refreshCookieBaseOptions` is already exactly correct for this target shape
  and needs no change — it already assumes "whatever fronts this in prod
  terminates TLS," which is precisely what this ADR commits to building. This
  ADR exists to record *that* commitment before the Helm/Ingress work lands, so
  the Ingress task doesn't have to re-derive why `Secure` is unconditional in
  prod.
- **Trust boundary**: once TLS terminates at the ingress, traffic from
  ingress → pod is plain HTTP inside the cluster's private network. That is
  the accepted cloud-native trust boundary (the same one this project's `db`
  connection already crosses unencrypted inside the compose network today) —
  encrypting pod-to-pod traffic (a service mesh, mTLS) is a separate, heavier
  decision this ADR does not make.

## Alternatives rejected

- **Terminate TLS inside the Node process** (`https.createServer` +
  certificate files mounted into the pod) — pushes certificate provisioning,
  renewal, and private-key handling into application code and image config,
  duplicated per replica; the ingress/ALB model centralizes all of that in one
  place designed for exactly this job. Also in tension with the non-root,
  reduced-attack-surface direction of ADR 0030 — private key material inside
  the app container is more, not less, exposure.
- **A sidecar TLS-terminating proxy per pod** (e.g., a per-pod Envoy) — real
  service-mesh territory, solving a problem (pod-to-pod encryption) this
  project doesn't have yet; premature relative to ADR 0030's Alternatives
  rejected reasoning about not building for infrastructure that doesn't exist.
- **Drop the `Secure` flag requirement instead** — would make the cookie work
  over plain HTTP, but defeats the reason `Secure` exists (Never Do Group 3):
  a refresh token is exactly the kind of value that must never cross an
  unencrypted connection. Not on the table.

## Consequences

- No diff to `main.ts`, `auth.controller.ts`, `Dockerfile`, or `.env.example` —
  this ADR is a forward-looking commitment, not an implementation.
- The Kubernetes `Ingress`/ALB + certificate provisioning is explicitly
  deferred to ROADMAP.md > Stage 4's Helm/K8s task; this ADR gives that task
  its target shape so it doesn't have to decide "where does TLS end" from
  scratch.
- Until that lands, `ENV=prod` cannot actually be run anywhere traffic reaches
  the app over plain HTTP without breaking refresh rotation — an accepted gap
  because nothing is deployed with `ENV=prod` yet (ROADMAP.md > Stage 4,
  deployment is still the unscheduled terminal act of the plan).

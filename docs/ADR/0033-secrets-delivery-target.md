# ADR 0033: Secrets Delivery Target — Kubernetes Secrets, AWS Secrets Manager Deferred

- Status: Accepted (design-only — no code change)
- Date: 2026-08-08
- Amends: [ADR 0015](0015-docker-and-compose.md) (Decision: "Secrets never
  baked" — `.env`/`env_file` for local dev; Consequences flagged this as not
  production-grade)
- Relates to: [ADR 0029](0029-storage-port-adapter.md) (the app never reads AWS
  credentials directly — the SDK's default provider chain resolves them)
- 한국어: [0033-secrets-delivery-target.ko.md](0033-secrets-delivery-target.ko.md)

## Context

`.env` + `env_file` (ADR 0015) is the right shape for a single local-dev
compose stack: one file, one machine, one trust boundary. It stops being the
right shape for a cluster deploy — there is no shared filesystem to put `.env`
on, no rotation story, and no audit trail for who read which secret when. This
project's `ConfigService`-only access rule (CLAUDE.md > Architecture Decisions
> Config) already means the application code has no idea *how* an env var's
value arrived — it only ever calls `getOrThrow('X')`. That existing boundary is
exactly what makes this decision low-risk: whichever delivery mechanism is
chosen, it changes nothing inside `backend/`.

## Decision

- **The target delivery mechanism is a native Kubernetes `Secret`, mounted into
  the pod as environment variables** (`envFrom: secretRef` in the eventual Helm
  chart) — not an application-level integration with any secrets-manager API.
  The app's `ConfigService`/Joi boundary stays exactly as it is today; only the
  *origin* of those env vars changes, from `env_file: .env` (compose, local) to
  a cluster-injected `Secret` (K8s, deployed).
- **AWS Secrets Manager, if adopted, sits upstream of the `Secret`, not beside
  the app.** The real-world shape this points toward is an External Secrets
  Operator (ESO) syncing an AWS Secrets Manager entry into a native `Secret`
  object, authenticated via IRSA (IAM Roles for Service Accounts) rather than
  static AWS credentials — but provisioning the Secrets Manager resource, the
  IAM role, and installing ESO are all Terraform/IaC work
  (ROADMAP.md > Stage 4 > production DevOps stack introduction) that does not
  exist yet. This ADR commits the project to *not* having application code ever
  call the Secrets Manager API or read AWS credentials directly — consistent
  with ADR 0029's existing stance — but does not build the ESO/IAM wiring
  itself.
- **No code changes land with this ADR.** `.env`/`env_file` stays exactly as
  ADR 0015 left it for local `docker compose up` — this ADR is a target
  decision that the Helm chart (next Stage 4 task) and the Terraform task
  (after it) implement against, written down now so neither of those tasks
  re-litigates "which secrets mechanism" mid-implementation.

## Alternatives rejected

- **AWS Secrets Manager called directly from application code** — would need
  the `@aws-sdk/client-secrets-manager` package, credential resolution inside
  `backend/`, and a caching/refresh strategy for a value that today is just an
  env var read once at boot. Every one of those is complexity the
  `ConfigService`-only boundary exists specifically to avoid; the SDK default
  provider chain resolving credentials happens for `S3Storage` (ADR 0029)
  because S3 access is an inherent runtime operation, not a boot-time secret
  lookup — this is not the same shape.
- **HashiCorp Vault** — the more capable option (dynamic secrets, fine-grained
  leasing, secret versioning with audit), but it is its own stateful service to
  run, back up, and unseal — operational weight disproportionate to a
  portfolio-scale project whose actual deploy target (AWS + Kubernetes,
  ROADMAP.md, already decided) has a native, zero-extra-infrastructure answer
  (Kubernetes `Secret`, optionally backed by AWS Secrets Manager). Vault stays
  available as a future candidate if a real multi-cloud or multi-tenant secret
  story ever emerges — nothing here forecloses it, but nothing today asks for it
  either.
- **`Idempotency-Key`-style client-provided values or a config-map-only
  approach (no `Secret` distinction)** — not applicable here; this decision is
  about credential-shaped values (DB password, JWT secrets), and Kubernetes
  already draws exactly that distinction (`ConfigMap` vs. `Secret`) as a
  first-class primitive — adopting anything else would be reinventing a
  distinction the target platform already makes.

## Consequences

- No immediate diff to `.env.example`, the Joi schema, or `docker-compose.yml`
  beyond what ADR 0032 already changes for the `migrate` service — this ADR is
  purely a recorded target for the Helm task to build against.
- The Helm chart (ROADMAP.md > Stage 4, next task) is expected to define a
  `Secret` template (or reference an externally-managed one) and wire
  `envFrom` — implementing that is out of this ADR's scope.
- The AWS Secrets Manager / External Secrets Operator / IRSA wiring is tracked
  in ROADMAP.md > Unscheduled as **not started because it requires a live AWS
  account, IAM roles, and a running Kubernetes cluster with ESO installed —
  none of which exist yet** — and is scheduled to land together with the
  Terraform introduction row (ROADMAP.md > Stage 4), which is the task that
  actually provisions those prerequisites.
- Kubernetes-native `Secret` values are base64-encoded, not encrypted, at rest
  by default; encryption-at-rest for `etcd` (or a sealed-secrets approach) is
  itself a cluster-level configuration decision for the Terraform/K8s task, not
  this one — noted here so it isn't assumed solved.

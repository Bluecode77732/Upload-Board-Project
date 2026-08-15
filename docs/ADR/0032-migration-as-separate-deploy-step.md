# ADR 0032: Migrations Run as a Separate Deploy Step, Not on Container Boot

- Status: Accepted
- Date: 2026-08-08
- Amends: [ADR 0015](0015-docker-and-compose.md) (Decision: "Migrations on boot"
  — the runtime `CMD` ran `migration:run` before `node dist/main`)
- 한국어: [0032-migration-as-separate-deploy-step.ko.md](0032-migration-as-separate-deploy-step.ko.md)

## Context

ADR 0015's `CMD` runs `migration:run` and then `node dist/main` on every
container start, chosen so `docker compose up` stays a single command against a
fresh volume. That was correct for the single-instance local-dev target it was
scoped to. It stops being correct the moment more than one instance boots from
the same image at once — a Kubernetes `Deployment` scaling to N replicas, or a
rolling update briefly running old and new pods together, means N containers
each racing to run `migration:run` against the same database on startup.
TypeORM's migration runner is not designed for concurrent execution: two
instances can both read "migration X not yet applied," both attempt to run it,
and the loser fails or (worse, depending on the migration's shape) partially
applies DDL concurrently with the winner. This is exactly the risk
[CLAUDE.md](../../CLAUDE.md) > Scope Discipline flags migrations as requiring
review for — ROADMAP.md > Stage 4 lists "migrations as a separate deploy step"
as a named precondition for going multi-instance.

## Decision

- **`Dockerfile`'s `CMD` no longer runs migrations.** It is `["node",
  "dist/main"]` only — the API container's only job at startup is to serve
  traffic once the schema is already correct.
- **`docker-compose.yml` gains a one-shot `migrate` service** built from the
  same image, overriding `command` to run exactly what the old `CMD` ran
  (`node node_modules/typeorm/cli.js migration:run -d dist/data-source.js`).
  `api` now `depends_on: migrate: condition: service_completed_successfully` (in
  addition to its existing `db: condition: service_healthy`), so `docker
  compose up` still applies the committed migrations before the API starts
  serving — the "single command against a fresh volume" property ADR 0015
  wanted is preserved, but the ordering is now explicit-step-then-serve instead
  of implicit-inside-boot.
- **This models, but does not yet build, the eventual Kubernetes shape.** A
  real multi-instance deploy needs the equivalent as a Kubernetes `Job` (or a
  Helm pre-install/pre-upgrade hook) that runs once per rollout, ahead of the
  `Deployment` scaling to N replicas — that manifest is Stage 4's Helm task, not
  this one. What lands here is the **image-level precondition**: the image no
  longer assumes it is the only thing that will ever run `migration:run`, and
  local dev (`docker compose up`) already exercises the "migrate, then serve"
  ordering the Job will reproduce.
- **`migration:run` stays idempotent** (unchanged from ADR 0006/0015) — a
  second `migrate` run against an already-current schema is a safe no-op. That
  property is what makes "run it as its own step, possibly more than once
  across a rollout" safe at all; this ADR does not add locking or
  leader-election, because the existing idempotency already covers the case a
  lock would exist to protect.

## Alternatives rejected

- **Keep migrations on boot, add a distributed lock (e.g., a Postgres advisory
  lock around `migration:run`)** — would genuinely fix the race, but is real
  new complexity (lock acquisition, timeout, a container ready-but-blocked
  state) for a problem the separate-step model avoids by construction. Revisit
  only if a future deploy shape truly cannot run a pre-rollout step.
- **A dedicated `Dockerfile` target that only contains the TypeORM CLI +
  `dist/data-source.js`** (a slimmer "migrator" image) — real production
  practice at larger scale, but this project has one Dockerfile and one image
  serving both roles (`api` normally, `migrate` via a command override) is
  simpler and sufficient at this project's size; revisit if the full runtime
  image's size or dependency surface becomes a problem specifically for the
  migration step.
- **Leave it exactly as ADR 0015 left it, deferring to the Kubernetes Job
  directly** — rejected because the image itself (not just the K8s manifest)
  encodes the boot-time coupling; fixing only the manifest layer while the
  image's `CMD` still runs migrations would leave `docker compose up` racing
  the moment anyone scaled the local `api` service, and would leave the image
  not actually reflecting the decision it claims to make.

## Consequences

- `docker compose up`'s single-command property is preserved, verified
  end-to-end (`db` healthy → `migrate` runs and exits 0 → `api` starts → `GET
  /doc` and `GET /health/ready` both answer).
- `Dockerfile` no longer bundles the TypeORM CLI invocation into its default
  `CMD`; anything that runs the image directly (`docker run`, without compose's
  `migrate` step) now needs the schema to already be current, or must override
  `command` to run `migrate` itself first — this is the intended, documented
  behavior, not an oversight.
- The Kubernetes-Job equivalent is not built here — it is explicitly deferred to
  ROADMAP.md > Stage 4's Helm task, which this ADR's `docker-compose.yml`
  `migrate` service gives a concrete local model to port from.
- No schema, entity, or API surface change.

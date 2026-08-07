# ADR 0030: Container Runs Non-Root; Distroless and Multi-Arch Deferred

- Status: Accepted
- Date: 2026-08-08
- Amends: [ADR 0015](0015-docker-and-compose.md) (Consequences: "the container runs as
  root with no distroless base... land with CI (Stage 1) and Stage 4")
- 한국어: [0030-container-non-root-and-arch-stance.ko.md](0030-container-non-root-and-arch-stance.ko.md)

## Context

ADR 0015 shipped a working multi-stage image but explicitly deferred production
hardening, including running the container as root. A process that runs as root
inside a container that is later compromised (a dependency RCE, a deserialization
bug) hands the attacker root inside the container's user namespace — on a shared
Kubernetes node, that is a materially larger blast radius than a non-root process
would allow. This is the first row of the container/deploy hardening ADR 0015
deferred, and the direct precondition for making the image orchestrator-eligible
(ROADMAP.md > Stage 4 > production DevOps stack introduction).

## Decision

- **Runtime stage gains a dedicated non-root user.** The `node:24.8.0-slim`
  runtime stage (unchanged base — see Alternatives rejected) creates a system
  group/user (`appuser`, uid/gid 1001), `chown`s `/app` — including the
  `file/temp`/`file/upload` directories created for the two-phase upload
  contract — and switches to it via `USER appuser` before `CMD`.
- **A `HEALTHCHECK` instruction is added**, calling the new `GET /health/live`
  endpoint ([ADR 0031](0031-health-and-readiness-endpoints.md)) via Node's own
  `http` module — no `curl`/`wget` package needed on the `slim` base, so this
  costs nothing extra in image size or attack surface.
- **Target architecture stays x64 for now, documented as a known constraint, not
  solved.** `bcrypt` ships prebuilt glibc binaries; the build stage already
  guarantees a matching-glibc runtime (ADR 0015's alternatives-rejected reasoning
  for `slim` over `alpine`), but every prebuild is x64. Moving to an ARM/Graviton
  node group (a real cost lever on AWS) would need either
  `pnpm.onlyBuiltDependencies` to force `bcrypt` to rebuild from source on an
  ARM build stage, or a swap to the pure-JS `bcryptjs`. Neither is done here —
  the actual instance architecture is a Terraform/node-group decision
  (ROADMAP.md > Stage 4) that does not exist yet, and building for an
  architecture nothing will run on is speculative work this project's Scope
  Discipline rejects. This ADR only records the constraint so the eventual
  Terraform ADR does not rediscover it.

## Alternatives rejected

- **`gcr.io/distroless/nodejs*-debian12` now** — distroless has no shell, which
  minimizes attack surface and ships non-root by default, but two things block
  adopting it in this change: (1) distroless publishes major-version tags
  (`nodejs22-debian12`, etc.) rather than patch-pinned ones, and whether a
  `nodejs24` tag exists at all was **not verified** against a live registry
  before this decision — verifying and then discovering it doesn't exist would
  block this entire hardening pass on an unrelated tag-availability problem; and
  (2) losing the shell removes the only debugging path (`docker exec`) this
  project has today, and the K8s-native replacement (ephemeral debug
  containers, `kubectl debug`) does not exist yet — adopting distroless before
  that replacement lands would be a net debuggability loss with no offsetting
  cluster tooling in place. Tracked as its own follow-up in ROADMAP.md >
  Unscheduled, to be revisited once the tag is confirmed and the K8s stage
  lands ephemeral-debug tooling.
- **Multi-arch (`buildx --platform linux/amd64,linux/arm64`) now** — would need
  either a `bcrypt` source rebuild path or a dependency swap, tested against
  real ARM hardware/emulation, for an architecture no deploy target has chosen
  yet. Deferred to the Terraform/node-group ADR that actually picks an instance
  family.
- **`chmod 777` instead of a dedicated user/`chown`** — keeps root as the
  process owner and just widens permissions; does not address the actual risk
  (process-owner capability inside the container), so it isn't a substitute for
  non-root at all.

## Consequences

- The image no longer runs as root; a compromised process inside the container
  no longer has root in the container's user namespace.
- **Residual, documented, not solved here**: `docker-compose.yml`'s bind mount
  (`./file:/app/file`, local dev only) preserves host ownership on native Linux
  hosts. If the host directory is owned by a different uid than the container's
  1001, `appuser` cannot write into it, and local `docker compose up` will fail
  to promote/serve files. Windows/Mac Docker Desktop's bind-mount translation
  layer is unaffected. A Linux contributor hitting this chowns the host `./file`
  directory to uid 1001 once (`sudo chown -R 1001:1001 file/`) — documented in
  README.md, not automated, since automating it would mean the Dockerfile
  reaching outside the container to mutate host filesystem state.
- Distroless and multi-arch stay open items (ROADMAP.md > Unscheduled), each
  blocked on a concrete precondition (registry-tag verification; a chosen
  deploy architecture) rather than left as vague "someday" work.
- No Joi schema, entity, or API surface change — this ADR is Dockerfile-only.

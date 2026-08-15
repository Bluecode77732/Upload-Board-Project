# ADR 0031: Liveness and Readiness Endpoints

- Status: Accepted
- Date: 2026-08-08
- Amends: [ADR 0015](0015-docker-and-compose.md) (Consequences: "no... health
  endpoint... land with CI (Stage 1) and Stage 4")
- 한국어: [0031-health-and-readiness-endpoints.ko.md](0031-health-and-readiness-endpoints.ko.md)

## Context

Nothing in this API answers "is the process up" or "can it serve traffic right
now." A load balancer or Kubernetes cannot route around an instance stuck behind
a dead DB connection, and cannot tell a slow-starting instance from a crashed
one, without a dedicated signal — this is a hard precondition for the
orchestrator work in ROADMAP.md > Stage 4, not an optional nicety.

## Decision

- **A new operational module, `HealthModule`** (`backend/health/`) — mirrors the
  `TempCleanupModule`/`StorageModule` precedent (Project-Specific Principles >
  Module Responsibility): infrastructure/cross-cutting concerns get their own
  module rather than being bolted onto a domain one. No existing domain module
  (`FileModule`, `UserModule`, ...) owns "is the process/DB reachable" as a
  concept.
- **Two endpoints, both unauthenticated by design**: `GET /health/live` (liveness
  — the process can answer HTTP at all, no dependency checks, always 200) and
  `GET /health/ready` (readiness — additionally runs `SELECT 1` through the
  injected `DataSource`; 200 when it succeeds, 503 `ServiceUnavailableException`
  when it doesn't). Neither carries `@UseGuards(JwtAuthGuard)` — a kubelet/LB
  probe carries no bearer token, and this project applies `JwtAuthGuard` per
  controller class rather than as a global `APP_GUARD`, so simply omitting the
  decorator is sufficient; no new guard or allowlist mechanism is introduced.
- **The DB ping lives in `HealthService.checkDatabase()`, not the controller** —
  this project's coverage measures services only (`package.json` `jest` config),
  and keeping the check testable without booting Nest matches every other
  service in the codebase. On failure the real error is logged via `Logger` at
  `error`; the client only ever sees a generic 503 message (Never Do Group 3 —
  Error Transparency: internal detail stays server-side).
- **No new DTO, entity, or Joi env var.** The readiness check reuses the
  already-injected `DataSource` (available without importing `TypeOrmModule`
  again — `TypeOrmModule.forRootAsync`'s internal module is `@Global()`, the
  same reason `FileService` injects `DataSource` directly today).
- **Swagger**: `@ApiTags('health')` on the controller, `@ApiResponse` for 200/503
  on `/health/ready` — kept minimal since this is an operational endpoint, not a
  documented client-facing feature.
- **`Dockerfile`'s new `HEALTHCHECK` instruction** (ADR 0030) calls
  `GET /health/live` — liveness, not readiness, because Docker's `HEALTHCHECK`
  restarts the container on repeated failure, and restarting a healthy process
  just because its *database* is briefly unreachable would cause a boot loop
  that fixes nothing (the DB, not the process, is what's down). Readiness is for
  the orchestrator's traffic-routing decision, not the container's own restart
  policy — a distinction this ADR keeps deliberately, and the Kubernetes
  manifests in the next Stage 4 task wire `/health/live` to `livenessProbe` and
  `/health/ready` to `readinessProbe` accordingly.

## Alternatives rejected

- **`@nestjs/terminus`** — the standard NestJS health-check package, but a new
  runtime dependency for what two `@Get()` handlers and one `SELECT 1` already
  cover; Scope Discipline requires justifying a new dependency, and there is
  nothing here Terminus's indicator composition earns its weight for yet (no
  disk-space check, no memory-heap check, no multiple downstream services).
  Revisit if a second dependency (e.g., a message queue) needs its own
  indicator later.
- **A single combined `/health` endpoint** — conflates two different consumers
  (container runtime vs. orchestrator traffic routing) with two different
  correct responses to the same failure (see the `HEALTHCHECK` reasoning
  above); kept them separate from the start rather than splitting later under
  a breaking-change constraint.
- **Guarding the endpoints behind a shared secret / internal-only network
  assumption** — probes are same-cluster traffic by construction (kubelet →
  pod, LB → target group) and carry no bearer token; adding auth here would
  just break every orchestrator's default probe client for no attacker-facing
  benefit (`GET /health/live` reveals nothing sensitive — Never Do Group 3's
  concern is response *content*, and this response carries none).

## Consequences

- `docker compose up`'s `api` service and any future Kubernetes deployment can
  now be probed; a DB outage now surfaces as a typed 503 for readiness instead
  of every request timing out or 500ing individually.
- `backend/app.module.ts` gains one import (`HealthModule`) — the only touch to
  a high-blast-radius file this change requires.
- No Swagger-documented client-facing feature is added; `README.md`'s API
  Endpoints section notes the two routes for operators, not application
  consumers.
- Coverage: `HealthService.checkDatabase()` is unit-tested with a mocked
  `DataSource`; `HealthController` stays uncovered by policy, consistent with
  every other controller in this codebase.

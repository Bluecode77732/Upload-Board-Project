# ADR 0053: Global Rate Limiting via `@nestjs/throttler`

- Status: Accepted — implemented, e2e-verified
- Date: 2026-09-10
- 한국어: [0053-global-rate-limiting.ko.md](0053-global-rate-limiting.ko.md)

## Context

A 2026-09-09 security review found that the backend has no request-rate limiting anywhere
— `POST /auth/register` and `POST /auth/signin` (Basic-token credential checks) included.
Nothing in the stack bounds how many attempts a single client can make per minute, so
credential brute-forcing is unconstrained beyond `HASH_ROUNDS`' per-attempt cost.

This is the first time any cross-cutting request guard has been proposed for this
repository. Existing guards (`JwtAuthGuard`, `RolesGuard`) are applied per-controller or
per-method via `@UseGuards(...)`, never globally via `APP_GUARD` — worth explaining before
introducing the first one:

- Authentication in this app is "protected by default, with a known, small set of
  deliberately public routes" — `POST /auth/register`, `POST /auth/signin`,
  `POST /auth/token/refresh` (Basic/cookie-based, not Bearer), `GET /health/*`,
  `GET /metrics`, and `GET /file/:id/content` (`OptionalJwtAuthGuard`). Making
  `JwtAuthGuard` global would need a reflector-based bypass mechanism (a `@Public()`
  decorator) this project has never built — introducing one only to flip a handful of
  routes back off is a new abstraction for a small, already-enumerated exception set, so
  per-controller `@UseGuards` stayed the simpler, existing-pattern-consistent choice
  (Hallucination Prevention #3: reuse existing patterns, don't introduce new abstractions
  unasked).
- Rate limiting inverts that shape: the entire premise of this task is "the whole backend
  has no limit," and the exception set is exactly two read-only, unauthenticated
  infrastructure endpoints (below). A per-controller `@UseGuards(ThrottlerGuard)` sprinkled
  across every domain controller would need to be remembered on every new controller, and a
  forgotten one fails *silently* — unlike a forgotten auth guard, which fails loudly as a
  401 the first time anyone tests the route. A missing rate limit is invisible until it is
  exploited. Global-by-default with two narrow, explicit exceptions is both less code and a
  better match for this failure mode.
- `@nestjs/throttler`'s own documented usage pattern *is* global `APP_GUARD` registration
  plus `@SkipThrottle()`/`@Throttle()` for exceptions — adopting it is using a third-party
  module the way its own authors designed it, the same category of "framework idiom, not a
  project-invented abstraction" this repository already grants Passport's `AuthGuard` and
  `@nestjs/mapped-types`' `PartialType` (Project-Specific Principles > Sanctioned
  Inheritance Points).

## Decision

### D1 — Global `ThrottlerGuard` via `APP_GUARD`, conservative default only

`backend/app.module.ts` registers `ThrottlerModule.forRootAsync` (`ttl: 60000`,
`limit: 100` — 100 requests/minute) and provides `ThrottlerGuard` via `APP_GUARD`,
following the same `useFactory` + `inject: [ConfigService]` shape already used for
`TypeOrmModule.forRootAsync` in the same file. This is the repository's first global guard.

Per-route tuning (e.g. a tighter limit on `POST /auth/signin` specifically) is deliberately
out of scope for this ADR — the developer asked for a single conservative global default
now, with route-specific limits deferred to a follow-up task.

### D2 — `HealthController`/`MetricsController` are exempted via `@SkipThrottle()`

Both controllers carry a class-level `@SkipThrottle()`. Unlike ordinary user-driven
traffic, kubelet's liveness/readiness probes and Prometheus' scrape requests are designed
to repeat on a fixed short interval for the entire lifetime of a running pod — a
fundamentally different traffic shape from a human calling the API occasionally. Sharing a
per-IP counter with other traffic risks two concrete failures: a 429 on a liveness probe
misreads as "process unresponsive" and triggers an unnecessary pod restart; a 429 on a
scrape produces a gap in the metrics time series. Both endpoints already go unauthenticated
for the identical reason (`GET /health/*` — ADR 0031; `GET /metrics` — ADR 0047) — this
extends that same "infrastructure caller, not a human" exception to rate limiting.

### D3 — `THROTTLE_ENABLED` env flag exists only to isolate the e2e suite, not to split dev/prod

`backend/app.module.ts`'s Joi schema gains `THROTTLE_ENABLED` (boolean, default `true`).
dev and prod both always run with it `true` — this flag is not a dev/prod axis, it exists
purely to separate "the real app" from "the e2e Jest process." `test/app.e2e-spec.ts` fires
several hundred sequential HTTP requests at one running server instance; supertest's
in-process requests all resolve to the same loopback client IP, so without an override they
would all share one throttle bucket and the suite would fail partway through on an
unrelated 429, not the behavior under test.

Because NestJS's module graph is static, the guard provider itself cannot be conditionally
omitted from config — `THROTTLE_ENABLED=false` instead widens `limit` to
`Number.MAX_SAFE_INTEGER` in the same `useFactory`, which is an effective bypass without a
second code path. `test/e2e-env.ts` sets it via `setupFiles` (before `AppModule` import,
same reason `DB_DATABASE` is set there rather than in `beforeAll`), mirroring the existing
`TEMP_SWEEP_ENABLED`/`GRANTED_SWEEP_ENABLED` naming and on/off convention.

## Consequences

- **Every route not explicitly exempted is now rate-limited**, including
  `POST /auth/register`/`POST /auth/signin` — closing the gap the security review found.
  Specific per-route limits (e.g. a tighter bound on sign-in attempts) remain a follow-up,
  not settled by this ADR.
- **Known limitation, accepted for now**: `@nestjs/throttler`'s default storage is
  single-instance in-memory. If this app is ever deployed with more than one replica, each
  pod counts independently, so the effective global ceiling loosens by a factor of the
  replica count. A Redis-backed `ThrottlerStorage` implementation removes this, but adds a
  new infrastructure dependency and is out of this task's scope — revisit if/when this app
  actually runs multiple replicas (it currently does not; the AWS/EKS stack described in
  ROADMAP.md §9 is torn down as of 2026-08-28).
- **Guard impact**: `ThrottlerGuard` now runs on every route in the app except
  `GET /health/live`, `GET /health/ready`, and `GET /metrics`. No existing `JwtAuthGuard`/
  `RolesGuard` coverage changes — this guard runs alongside them, not in place of them.
- **New env var**: `THROTTLE_ENABLED` (Joi + `.env.example`, default `true`). Never read via
  `process.env` directly — only through `ConfigService` in `app.module.ts`'s factory.
- **Alternatives considered and rejected**: per-controller `@UseGuards(ThrottlerGuard)`
  (D1's rationale above); adopting Redis-backed storage immediately (new dependency, no
  live multi-replica deployment to justify it now); overriding `limit` directly in
  `test/e2e-env.ts` instead of a named `THROTTLE_ENABLED` flag (rejected — a dedicated flag
  states intent more clearly and matches the existing `*_ENABLED` naming convention).
- **Verified**: `pnpm lint` (clean), `pnpm test` (263/263), and `pnpm test:e2e` (76/76,
  against `docker compose up -d db` on port 5435) all pass — see the Addendum below.

### Addendum (2026-09-10) — 429 responses were miscoded as `INTERNAL_ERROR`, fixed

A follow-up investigation into whether other docs needed updating surfaced a real defect
this ADR's own implementation introduced: `@nestjs/throttler`'s `ThrottlerException` is a
framework-thrown `HttpException(string, 429)` with no `code` field, and
`AllExceptionsFilter`'s `FALLBACK_CODES` map (`backend/common/filter/all-exceptions.filter.ts`)
had no entry for `HttpStatus.TOO_MANY_REQUESTS` — so every 429 fell through to
`ErrorCode.INTERNAL_ERROR`, misreporting a client-side rate-limit rejection as a server
fault and breaking ADR 0011's frozen `{ code, message }` contract for this status for the
first time.

Fixed the same way `PAYLOAD_TOO_LARGE` already covers Multer's framework-thrown 413:
`ErrorCode` gained `RATE_LIMITED` (`backend/common/error-code.ts`), and `FALLBACK_CODES`
gained `[HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED`. A new spec case
(`all-exceptions.filter.spec.ts`, constructing a real `ThrottlerException`) pins this —
264/264 unit tests pass. This is an addition to the `ErrorCode` enum, not a rename or
removal, so it is free under ADR 0011 ("adding one is free").

**Frontend mirror — synced, on explicit confirmation**: `frontend/src/api/errorCodes.ts`
mirrors this enum by hand (no shared codegen exists yet) and `frontend/CLAUDE.md` states
the mirror must be kept in sync "in the same change" the backend's contract changes. Since
this touches a file outside a backend-scoped task's boundary (root `CLAUDE.md`: "do not
edit backend files from a frontend task or vice versa"), it was confirmed with the
developer before editing rather than done silently. `RATE_LIMITED` was added to
`errorCodes.ts`, and `frontend/docs/API-CONTRACT.md` (+ `.ko.md`) gained a note that every
route can now return `429 RATE_LIMITED` — currently with no dedicated UI message anywhere
in the app, falling through to each caller's existing generic error display.
`pnpm build`/`pnpm lint` in `frontend/` both pass. `admin/` was checked too: it has no
equivalent closed-enum mirror (only one file branches on `code` at all, for a role-change
error), so this gap does not apply there.

### Addendum (2026-09-10) — e2e run confirmed against a live DB

Docker Desktop was unavailable in the original implementing session (engine unreachable),
so the e2e suite's 429-avoidance claim in D3 was design-only at first write. Once Docker was
started, `docker compose up -d db` brought up the existing `postgres:16` container on
5435, and `pnpm test:e2e` ran all 76 cases in `test/app.e2e-spec.ts` clean — no 429s, no
`THROTTLE_ENABLED`-related failures. This confirms the `test/e2e-env.ts` override actually
neutralizes the global 100/minute default for the suite's several-hundred-request run, not
just in design.

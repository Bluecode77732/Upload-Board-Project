# ADR 0017: Logging Conventions with Nest's Built-in Logger

- Status: Accepted
- Date: 2026-07-25
- 한국어: [0017-logging-conventions.ko.md](0017-logging-conventions.ko.md)

## Context

Observability was zero — no logger anywhere in the backend. The global
`AllExceptionsFilter` ([ADR 0011](0011-error-code-contract.md)) built the error
response but logged nothing, so an unexpected 500's stack — deliberately withheld
from the client response (Never Do Group 3) — vanished entirely. A backend that
cannot be diagnosed cannot be operated (the first prerequisite of the production
target). This is Stage 1's first observability increment; structured logging and
external error tracking (e.g. Sentry) are explicitly deferred until a deploy
environment exists (Stage 4).

## Decision

- **Nest's built-in `Logger`** — no new dependency (winston/pino deferred). One
  `new Logger(context)` per class.
- **The exception filter is the first and central log site.** `AllExceptionsFilter`
  now logs every caught error: **`>= 500` at `error` with the stack** (the same
  stack kept out of the client body), **`4xx` at `debug`** so routine
  auth/validation failures stay quiet unless debug is enabled. One central sink
  captures every unhandled and every `HttpException` throw.
- **What is logged:** `status code method url` only — **never** request bodies,
  headers, tokens, or entities (Never Do Group 3, no PII/secrets). URLs carry no
  credentials (Basic auth is a header, not the path).
- **Level convention** going forward: `error` = server fault needing attention
  (with stack); `warn` = recoverable/degraded; `log` = notable lifecycle;
  `debug`/`verbose` = diagnostics, off by default. New code logs at the boundary of
  a failure it handles, not on every branch.
- **Scope: conventions + the filter site.** No request-logging middleware, no
  external sink, no log shipping — those land with the deploy environment.

## Alternatives rejected

- **winston / pino now** — a dependency and config surface before there is anywhere
  to ship logs. Nest `Logger` covers the console-first increment; structured/JSON
  output lands with the deploy target.
- **Log 4xx at `warn`/`error`** — floods the log with routine 401/validation
  failures. `debug` keeps them available without the noise.
- **A request-logging interceptor/middleware** — useful, but broader than a "first
  increment"; the error sink is where the diagnostic value is highest.
- **Logging inside every service `catch`** — scatters the concern across the
  codebase; the central filter already sees every thrown error.

## Consequences

- Unexpected 500s are now diagnosable server-side (full stack) while the client
  still gets the generic `INTERNAL_ERROR` body — the ADR 0011 contract is unchanged.
- CLAUDE.md's "no logging infrastructure exists" Observability note is updated: Nest
  `Logger` is used in the filter (built-in, no new dep); winston/external tracking
  still absent.
- Nest's default levels surface `error`/`warn`/`log`; `debug` is opt-in, so 4xx
  noise stays off in production.
- No structured/JSON output or correlation IDs yet — a Stage 4 concern tied to the
  deploy environment.

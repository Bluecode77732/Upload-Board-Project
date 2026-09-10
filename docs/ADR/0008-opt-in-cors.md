# ADR 0008: Opt-in CORS via `CORS_ORIGIN`

- Status: Accepted
- Date: 2026-07-22
- 한국어: [0008-opt-in-cors.ko.md](0008-opt-in-cors.ko.md)

## Context

The API had no CORS configuration at all — fine for same-origin/Swagger use, but any
future browser frontend on another origin would be blocked. The two failure modes to
avoid are hardcoding origins in source, and the classic `origin: '*'` (which lets any
domain drive authenticated requests).

## Decision

CORS stays **off by default** and is enabled only when the optional `CORS_ORIGIN` env
var is set (`backend/main.ts`):

- `CORS_ORIGIN` holds a comma-separated allowlist of origins, split and trimmed at
  bootstrap; it is declared optional in the Joi schema and documented in `.env.example`.
- When enabled: `credentials: true`, methods `GET, POST, PATCH, DELETE, OPTIONS`,
  allowed headers `Content-Type, Authorization`.
- Unset variable = `enableCors` is never called — no permissive default.

**Never**: `origin: '*'`, hardcoded origins in `main.ts`.

## Consequences

- Local Swagger/same-origin use needs zero configuration.
- A browser frontend is a one-line env change, not a code change.
- Anyone adding a frontend must remember to set the variable — the failure mode is a
  visible CORS error in the browser console, not a silent security hole.

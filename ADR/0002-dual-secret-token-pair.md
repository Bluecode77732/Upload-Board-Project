# ADR 0002: Dual-Secret Access/Refresh Token Pair with `type` Claim

- Status: Accepted
- Date: 2025-12-17
- 한국어: [0002-dual-secret-token-pair.ko.md](0002-dual-secret-token-pair.ko.md)

## Context

A single JWT secret for both access and refresh tokens means any structurally valid
token verifies against any endpoint — a long-lived refresh token could be replayed as
an access token, silently extending session lifetime from minutes to the refresh
window. Session-based auth was ruled out (stateless API, no session store).

## Decision

- Two secrets: `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET`, with separate numeric
  expiry env vars (`*_EXPIRES_IN`).
- Payload shape: `{ sub: userId, type: 'access' | 'refresh' }`
  (`src/auth/interface/payload-interface.ts`).
- `parseBearerToken(rawToken, isRefreshToken)` verifies with the matching secret
  **and** checks `payload.type` — never one without the other.
- `JwtStrategy` validates access tokens only; `POST /auth/token/refresh` takes
  the refresh token as a Bearer header and returns a new access token.
  (2026-07-23: refresh route canonicalized to `POST /auth/token/refresh` —
  [ADR 0010](0010-frontend-split-and-api-surface-freeze.md).)
- `issueToken` takes `Pick<UserEntity, 'id'>` so a bare JWT payload
  (`{ id: payload.sub }`) can be re-tokenized without a DB round trip.
- `JwtModule.register({})` is deliberately empty — per-call secrets are the point.

**Never**: a single shared JWT secret, session-based auth, storing tokens server-side.

## Consequences

- Refresh-as-access replay is structurally impossible: wrong secret fails verification,
  and even a same-secret bug would be caught by the `type` check.
- Any new token consumer must replicate both checks; the rule is codified in
  `CLAUDE.md` (Dual Token Authority).
- There is no server-side revocation — a leaked refresh token stays valid until expiry
  (accepted trade-off for a stateless portfolio API).

# ADR 0012: Refresh Token as httpOnly Cookie with Rotation and Reuse Detection

- Status: Accepted
- Date: 2026-07-24
- 한국어: [0012-refresh-cookie-rotation.ko.md](0012-refresh-cookie-rotation.ko.md)

## Context

[ADR 0002](0002-dual-secret-token-pair.md) returned both tokens in the response
body and accepted "a leaked refresh token stays valid until expiry" as the
trade-off of a stateless API whose only consumer was Swagger. The frontend-split
decision ([ADR 0010](0010-frontend-split-and-api-surface-freeze.md)) breaks that
premise: a browser client must store the refresh token somewhere JavaScript can
reach (XSS surface), and a stolen long-lived token with no server-side
invalidation is the worst failure mode a browser app can inherit. This task was
pulled forward from Stage 2 for exactly that reason — settle the auth transport
before the first frontend line is written.

## Decision

- **Transport** — the refresh token travels only as an httpOnly cookie named
  `refreshToken`; response bodies carry the access token alone
  (`{ accessToken }`). Cookie attributes: `HttpOnly`, `SameSite=Strict`
  (the cookie is XHR-only, so Strict equals Lax in behavior while being the
  strictest default), `Path=/auth/token` (sent to the refresh endpoint alone),
  `Max-Age` = `REFRESH_TOKEN_SECRET_EXPIRES_IN`, `Secure` when `ENV=prod`, no
  `Domain` (host-only). The access token stays a Bearer header (unchanged).
- **Server-side anchor** — `UserEntity.refreshTokenHash` (nullable,
  `@Exclude`-ed) stores the **SHA-256** of the current refresh token; `null`
  means no active session. SHA-256, not bcrypt: JWT strings exceed bcrypt's
  72-byte input limit (silent truncation), and a high-entropy token needs no
  slow hash. One column, not a token table — one session per account is the
  accepted portfolio-scale trade-off (a new login logs out other devices);
  a multi-device session table is a separate task if ever needed.
- **Rotation with reuse detection** — `POST /auth/token/refresh` verifies the
  cookie JWT (secret **and** `type` claim, per ADR 0002), then compares its
  SHA-256 against the stored hash:
  - match → issue a fresh pair, store the new hash, re-set the cookie;
  - mismatch → a rotated-out token was replayed: the stored hash is cleared
    (whole session invalidated) and the client gets 401
    `AUTH_REFRESH_REUSED` (new code, additive per ADR 0011);
  - no stored hash / unknown user / bad JWT → 401 `AUTH_TOKEN_INVALID`.
- **Signout becomes real** — new `POST /auth/signout` (access-token guarded)
  clears the stored hash and the cookie; route addition is free under the
  ADR 0010 freeze.
- **ADR 0002 amendment** — the "never store tokens server-side" clause is
  amended (dated note in ADR 0002): what is stored is a *hash* of one current
  token as a rotation anchor, not a token store; the dual-secret + `type`-claim
  decision itself is unchanged. `parseBearerToken` was decomposed — the bare
  `verifyToken(token, isRefreshToken)` core (secret + type, never one without
  the other) survives; the "Bearer "-splitting wrapper lost its last consumer
  and was removed.

## Alternatives rejected

- **Keep body-delivered refresh + frontend localStorage** — leaves the XSS
  surface this task exists to close; switching later would be a double breaking
  change (frontend + backend) instead of one pre-consumer change.
- **Refresh-token table (multi-device sessions, token families)** — real
  requirement not present; one nullable column delivers rotation + reuse
  detection at a fraction of the schema and code cost.
- **`SameSite=Lax` / `None`** — Lax adds nothing over Strict for an XHR-only
  cookie; None abandons CSRF protection and forces HTTPS locally, and is only
  needed for a cross-domain deployment (revisit in the Stage 4 deployment ADR).
- **bcrypt for the stored hash** — silently truncates at 72 bytes; wrong tool
  for high-entropy JWT strings.

## Consequences

- Breaking (sanctioned, pre-declared Stage F task with zero consumers):
  `signin`/`signin/local` bodies shrink to `{ accessToken }`; the refresh
  endpoint consumes a cookie instead of a Bearer header.
- A stolen refresh token is now useful only until the next legitimate refresh,
  and its replay kills the whole session loudly (`AUTH_REFRESH_REUSED`).
- The frontend must send `credentials: 'include'` on refresh/signout calls and
  never sees the refresh token at all.
- One session per account until a session-table task is ever scheduled.
- Stage F is complete — the API surface, error contract, and auth transport a
  frontend depends on are all settled; the frontend repository can start
  (RBAC proceeds in parallel, changing no API surface).

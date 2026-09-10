# ADR 0028: Access Token Carries a `role` Claim

- Status: Accepted
- Date: 2026-08-05
- Amends: [ADR 0002](0002-dual-secret-token-pair.md) (`Payload` shape only)
- Relates to: [ADR 0013](0013-rbac-and-audit-log.md) (the role hierarchy this exposes),
  [ADR 0022](0022-admin-console-import-from-chat-project.md) (the blocked consumer)
- 한국어: [0028-access-token-role-claim.ko.md](0028-access-token-role-claim.ko.md)

## Context

[ADR 0013](0013-rbac-and-audit-log.md) shipped three role tiers and server-side enforcement
(`RolesGuard` + `@Roles`), but no way for a client to learn its own role. The access-token
payload is deliberately minimal — `{ sub, type }` ([ADR 0002](0002-dual-secret-token-pair.md))
— so a client holding only that token cannot tell a `user` from an `admin`. Any admin UI needs
this to gate its own routes (there is no server-side cost to a client rendering the wrong menu,
but there is a UX cost, and the imported console assumes the information exists).

[ADR 0022](0022-admin-console-import-from-chat-project.md)'s modification backlog recorded this
concretely: the imported `admin/` console reads `jwtDecode<{ sub, role }>(accessToken)` and
gates its routes on the result. Against this API the decode finds no `role` field, so the guard
sees `undefined` and rejects every admin — the console cannot function until this is resolved,
and ROADMAP names it the row that **blocks the rest of Stage 5**.

Two things this ADR is careful to keep separate: **who may act** and **who knows what they
can do**. `RolesGuard`/`AuthUser` already answer the first question correctly today —
`JwtStrategy.validate` loads the user from the database (`userService.findOne(payload.sub)`)
on every single request and returns the live `role` as part of `request.user`, which is what
both consumers actually read. The access-token payload has never been part of that
enforcement path. This decision is only about the second question: giving the client a way to
read its own role without an extra round trip.

## Decision

**The access-token payload gains an optional `role: UserRole` field
(`backend/auth/interface/payload-interface.ts`), populated only on access tokens.** Refresh
tokens keep their existing minimal shape (`{ sub, type, jti }`) — a refresh token is never
decoded by a client for UI purposes, so there is nothing for it to carry.

- `AuthService.issueToken(user, isRefreshToken)` now takes
  `Pick<UserEntity, 'id' | 'role'>` (previously `Pick<UserEntity, 'id'>`) and includes
  `role: user.role` in the payload only in the access-token branch, mirroring the existing
  `jti`-only-on-refresh conditional.
- `AuthService.issueTokenPair` widens the same way; every call site
  (`signIn`, `rotateRefreshToken`, `AuthController.userLocalLoginPassport`) already holds a
  full `UserEntity` (or the Passport-validated equivalent), so no runtime change was needed
  there beyond widening `userLocalLoginPassport`'s locally-declared request type.
- **No change to enforcement.** `JwtStrategy.validate`, `RolesGuard`, and `AuthUser` are
  untouched — they still source `role` from a fresh `userService.findOne` read on every
  request, never from the token payload. The new claim is read by clients only.

## Why this shape, against the alternatives considered

| Criterion | A. Role claim on the access token (**chosen**) | B. Client calls `GET /user/:id` | C. New `GET /auth/me` endpoint |
|---|---|---|---|
| `Payload`/ADR 0002 change | Yes | No | No |
| New endpoint | No | No | Yes |
| Extra request per app load/refresh | **None** — decoded from the token already in hand | One | One |
| Role freshness | Bounded by access-token TTL (locally 180s; env-configurable) | Always live (DB read) | Always live (`request.user`, no extra query) |
| Client must already know its own id | No | Yes — still needs to decode `sub` to call the route | No |
| Fit with existing client pattern | **Matches** — the frontend already decodes the access token client-side for `sub` ([Frontend Repo memory](../../CLAUDE.md); no frontend ADR), and the imported `admin/` console already assumes `jwtDecode<{ sub, role }>` | Piggybacks on a route with **no ownership guard today** (any authenticated user can already read any other user's row by id) | New surface on `AuthModule`, which otherwise owns tokens only (Module Responsibility) |

Option A was chosen for two reasons that outweigh its one real cost:

1. **It matches a pattern already in production**, rather than introducing a new one. The
   frontend already treats the access token as a client-decodable envelope; adding one more
   field to what it already reads is a smaller change in practice than teaching every client
   to make a second request on every login and every silent refresh.
2. **The staleness window is bounded and non-authoritative, not a security gap.** The one
   real cost of Option A — a demoted admin's *decoded* role can lag for up to the
   access-token TTL — never translates into a live privilege. `RolesGuard` re-derives role
   from the database on every request regardless of what the presented token's `role` claim
   says, so the worst case is a stale menu item in the client UI, not a bypassed check. Given
   that, a short, TTL-bounded window is the safer place to accept staleness: it is a UI-only
   fact with a hard expiry, not an unbounded cache with no invalidation signal.

Options B and C were both rejected on the same axis: they are more correct in the narrow
sense (role is always live), but that correctness is not needed here, because the thing being
protected (actual authorization) was never at stake — only a client-side display value was.
Paying a request on every app load to keep a UI-only value live, when the enforcement path
already re-derives it live regardless, is optimizing a property nothing depends on.

## Alternatives rejected

- **B. Client fetches role via `GET /user/:id`** — rejected primarily because it does not
  remove the client's need to decode the token: the client still has no way to learn its own
  `id` without decoding `sub`, so this trades "decode one more field" for "decode one field,
  then make a request" — strictly more work for the same trust model, since the request
  target itself piggybacks on a route with no ownership check today (any authenticated user
  can already look up any other user by id — a pre-existing, separate condition this ADR does
  not change).
- **C. New `GET /auth/me` endpoint** — the cleanest shape in isolation (no id-guessing, reuses
  `AuthUser`, no `Payload` change), but rejected here because it solves a problem Option A
  already solves for free: the round trip it adds runs on every app load and every silent
  refresh, for a value (role) that Option A already delivers from data the client already
  holds. Recorded as the fallback if Option A's staleness window is ever judged unacceptable
  for a future privileged UI surface — it would supersede this ADR's payload change, not
  extend it.

## Consequences

- **`Payload` gains one optional field.** `role?: UserRole`, present only on access tokens.
  Additive to the JWT payload shape; no existing consumer breaks (`jti` already established
  the same "field present on one token type only" pattern).
- **`issueToken`/`issueTokenPair` signatures widen** from `Pick<UserEntity, 'id'>` to
  `Pick<UserEntity, 'id' | 'role'>`. Every current call site already held a full `UserEntity`
  (or Passport's validated equivalent), so this is a compile-time-only change everywhere
  except `AuthController.userLocalLoginPassport`'s locally-declared request type, which
  widened to match.
- **The `id`-only signature's documented allowance — re-tokenizing from a bare JWT payload
  (`{ id: payload.sub }`) with no DB round trip ([ADR 0002](0002-dual-secret-token-pair.md))
  — is closed.** No current call site ever exercised it (`signIn`, `rotateRefreshToken`, and
  `userLocalLoginPassport` all already hold a full user from a prior DB read), so this is a
  latent capability lost, not a behavior change. A future caller wanting to re-tokenize from a
  bare `sub` alone would need a `role` from somewhere else first — the DB read this ADR was
  written to avoid paying elsewhere.
- **No change to server-side authorization.** `RolesGuard`/`AuthUser` continue to read
  `request.user.role`, sourced fresh from `JwtStrategy.validate`'s per-request database
  lookup. The access token's `role` claim is never consulted by any guard — it exists purely
  for a client to read.
- **A role change (`PATCH /user/:id/role`) already nulls the target's `refreshTokenHash`**
  ([ADR 0013](0013-rbac-and-audit-log.md)), ending their session at the next refresh attempt.
  Combined with the short access-token TTL, the client-visible role claim self-corrects
  quickly even in the one case (a demotion) where staleness could matter for UI purposes.
- **Unblocks Stage 5's remaining rows.** The imported `admin/` console's
  `jwtDecode<{ sub, role }>(accessToken)` assumption now holds against this API; adapting the
  console (ROADMAP Stage 5, row 2) can proceed.
- **No schema change, no migration, no new error code, no new endpoint.**

# ADR 0013: Role-Based Access Control and Audit Log

- Status: Accepted
- Date: 2026-07-25
- 한국어: [0013-rbac-and-audit-log.ko.md](0013-rbac-and-audit-log.ko.md)

## Context

Until now every authenticated user was equal: writes were guarded only by
ownership checks ([ADR 0007](0007-ownership-checks-without-rbac.md)) — self-only
for user accounts, creator-only for files. There was no notion of an
administrator, so nobody could moderate another user's content, and the
frontend's `/admin` route section ([ADR 0010](0010-frontend-split-and-api-surface-freeze.md))
had no backend to stand on. RBAC was a decided roadmap item (Stage 0), unblocked
once migrations were adopted ([ADR 0006](0006-schema-policy-and-migration-adoption.md))
and deferred behind Stage F so the API surface froze first.

## Decision

- **Three roles as a string enum** — `user | admin | superadmin`
  (`backend/auth/role/role.ts`), stored as a `varchar` on `UserEntity.role`
  (default `'user'`). A `ROLE_RANK` map gives them an order so a higher role
  satisfies a lower requirement. String values (not integers) keep the DB column
  and Swagger readable.
- **RolesGuard + @Roles** — the NestJS-idiomatic pair. `@Roles(UserRole.admin)`
  marks a handler; `RolesGuard` compares `request.user.role`'s rank against it.
  An unmarked handler passes (the guard imposes nothing), so it composes with
  `JwtAuthGuard` without forcing a role on every route.
- **Ownership extends to "self OR admin"** — the ADR 0007 checks now also pass
  when the actor is admin+. User self-checks stay in the controller; file
  creator-checks stay in the service (`canManage`). Identity/role come from the
  JWT via the new `@AuthUser` decorator (`{ id, role }`), never the body.
- **Role assignment is superadmin-only** — `PATCH /user/:id/role`. The mutation
  runs in a `SERIALIZABLE` transaction with a row lock and **refuses to demote
  the last superadmin** (`AUTH_LAST_SUPERADMIN`) so the role system can never
  lock itself out. Any role change also **clears the target's refresh session**
  (`refreshTokenHash = null`, [ADR 0012](0012-refresh-cookie-rotation.md)) so a
  demotion takes full effect immediately, not just on the next access token.
- **superadmin management = resident with a demotion path** — superadmins are
  mutually and self-demotable (never the last one); a stale high-privilege
  account is cleaned up by demotion, not deleted. Account TTL/auto-expiry was
  rejected: it would deadlock the role system, need a scheduler this repo does
  not have, and fight the seed. Idle accounts are already neutralized by session
  expiry, and every role change is audited.
- **Audit log** — an append-only `audit_log_entity` (`actorId`, `targetId`,
  `action`, `detail`, `createdAt`) records `ROLE_CHANGE`, `USER_DELETE`, and
  `FILE_DELETE`. It has **no foreign keys** — hard-deleting a user must not
  cascade away the record of that deletion. Writes happen *after* the primary
  transaction commits (side effect isolated: a log failure never rolls back the
  action). `GET /audit-log` (admin) is paginated with a `(action, createdAt)`
  index.
- **First superadmin via env seed** — `SuperadminSeedService` promotes the
  `SUPERADMIN_EMAIL` account on boot (no-op if unset or already promoted). The
  account must be registered first; the next boot promotes it. No new
  infrastructure, no manual SQL.

## Alternatives rejected

- **Account TTL / auto-expiry for superadmin** — deadlock (no one left to
  promote), requires a scheduler (new dependency, Scope Discipline), and
  conflicts with the boot seed. Session expiry + audit already cover the "stale
  privileged account" concern.
- **superadmin fully immutable** — safest against in-app mistakes, but leaves no
  in-app path to clean up a stale superadmin (DB/env only). Model ① (last-one
  guard) keeps a demotion path without the lock-out risk.
- **Integer role enum** (Chat-project style) — cheaper rank comparison, but the
  DB column and Swagger read as opaque numbers; string values are self-documenting.
- **Numeric/bitmask permissions** — premature; three ordered tiers cover every
  current requirement.

## Consequences

- `UserEntity.role` is server-controlled: `UpdateUserDto` has no `role` field, so
  the global whitelist pipe strips any client attempt to set it — role changes
  only through the superadmin endpoint.
- New throw sites carry error codes (`FORBIDDEN`, `FORBIDDEN_NOT_OWNER`,
  `AUTH_LAST_SUPERADMIN`) per the ADR 0011 contract.
- ADR 0007's ownership checks are now *layered under* RBAC, not replaced — the
  "future RBAC guard should unify placement" note there is resolved by `@AuthUser`
  + `canManage`.
- Stage 0 is complete. The role system is ready for the frontend `/admin`
  section; admin promotion to a dedicated app remains an ADR 0010 future decision.

> **Note added 2026-07-30** — the deferred question in the bullet above is answered by
> [ADR 0022](0022-admin-console-import-from-chat-project.md): admin becomes a dedicated app at
> `admin/`, imported from the author's Chat Project (which implements this same three-tier
> hierarchy) rather than written from scratch. **This decision does not change anything in this
> ADR** — no role, guard, endpoint, or audit behavior is affected. It matters here only because
> it names the owner of the operator surface this ADR deliberately did not ship: role listing,
> promotion/demotion through `PATCH /user/:id/role`, and a viewer for `ROLE_CHANGE` audit rows.
> Until that import is adapted, the hierarchy remains operable **only** through Swagger or a raw
> request, and the two invariants defined here — the last-superadmin refusal
> (`AUTH_LAST_SUPERADMIN`) and session termination on any role change — stay invisible to
> whoever exercises them. ADR 0022 records both as required UI behavior.

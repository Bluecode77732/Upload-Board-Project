# ADR 0004: Transaction Pattern Selection per Multi-Write

- Status: Accepted
- Date: 2025-12-17 (table formalized 2026-07-22 in `CLAUDE.md`)
- 한국어: [0004-transaction-pattern-selection.ko.md](0004-transaction-pattern-selection.ko.md)

## Context

`FileService.uploadFile` must insert a `FileEntity` row **and** physically rename the
uploaded file, succeeding or failing together. TypeORM offers three viable shapes:
plain repository calls (auto-commit), `dataSource.transaction(callback)` (lifecycle
managed by TypeORM), and a manual QueryRunner (developer manages every step). The
`@Transaction()` decorator was removed in TypeORM 0.3 and is not an option.

## Decision

Pattern choice is a design-time decision, made per handler from this table:

| Pattern | Lifecycle | Use when | Project status |
|---|---|---|---|
| Plain repository call | TypeORM implicit (auto-commit) | Single write, no side effect | Default — `UserService`, `FileService.deleteFile` |
| Manual QueryRunner | Developer-managed, `release()` in `finally` | Multiple writes **+ a non-DB side effect inside the boundary** (file rename) | Established — `FileService.uploadFile` / `updateFile` |
| `dataSource.transaction(cb)` | TypeORM-managed begin/commit/rollback/release | Pure multi-DB writes, no side effect | Allowed; no current usage — preferred for new pure-DB cases (release can't be missed) |
| `@Transaction()` decorator | — | — | **Forbidden** (removed in TypeORM 0.3) |

(2026-07-30: the **Project status** column is the snapshot at decision time, not a live
index — `CLAUDE.md` > Transaction Boundary is the authoritative one. `dataSource.transaction(cb)`
is no longer unused: `UserService.updateRole` adopted it ([ADR 0013](0013-rbac-and-audit-log.md))
and `UserService.remove` uses it for the account-deletion cascade
([ADR 0020](0020-account-deletion-cascade.md)). The *selection rule* below is unchanged.)

The rename is placed *before* `commitTransaction` — the minimal divergence window this
design accepts: a rename failure rolls the insert back; only a commit failure after a
successful rename can diverge. The reverse holds for deletion: `unlink` has no rollback, so
it runs *after* the commit and its only failure mode is a recoverable orphan on disk
([ADR 0020](0020-account-deletion-cascade.md)).

## Consequences

- `release()` must always sit in `finally`, rollback in `catch`, and outward errors
  stay generic (`"Transaction aborted."`) — internal details never leak.
- New multi-write handlers state their pattern choice and reason before implementation
  (enforced by `CLAUDE.md`'s Clarification Protocol).
- Manual QueryRunner is the *exception*, justified only by the in-transaction side
  effect; copying it into pure-DB code reintroduces avoidable lifecycle risk.

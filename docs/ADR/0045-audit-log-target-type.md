# ADR 0045: Audit Log `targetType` — a Discriminator for the Polymorphic `targetId`

- Status: Accepted — implemented
- Date: 2026-08-24
- Amends: [ADR 0013](0013-rbac-and-audit-log.md)'s "Audit log" bullet — that bullet lists
  `audit_log_entity`'s columns as `actorId`, `targetId`, `action`, `detail`, `createdAt`
  and never records that `targetId` holds a different kind of id depending on `action`.
  The column list and that omission are both corrected here; no other part of ADR 0013
  (roles, guards, endpoints, the seed) is affected
- 한국어: [0045-audit-log-target-type.ko.md](0045-audit-log-target-type.ko.md)

## Context

ADR 0013 shipped `audit_log_entity` as an append-only, FK-free table. Five call sites
write to it, and each passes a different kind of id in the same `targetId` column:

| Call site | `action` | What `targetId` holds |
|---|---|---|
| `user.service.ts` `updateRole` | `ROLE_CHANGE` | user id |
| `user.service.ts` `remove` | `USER_DELETE` | user id |
| `file.service.ts` `deleteFile` | `FILE_DELETE` | **file** id |
| `post.service.ts` `deletePost` | `POST_DELETE` | **post** id |
| `comment.service.ts` `deleteComment` | `COMMENT_DELETE` | **comment** id |

`targetId` is therefore a polymorphic reference stored without a discriminator — the
column holds a bare integer, and nothing in the row says what kind of thing that integer
identifies.

On 2026-08-12 a `userId` filter was added to `GET /audit-log` for the admin console's
user detail panel (`docs/CHANGELOG.md`). It builds `actorId = :id OR targetId = :id`,
which reads every `targetId` as a user id. All five actions already existed by then, so
the filter has produced false positives since the day it landed: any file, post, or
comment whose id happens to equal a user id makes an unrelated record surface as that
user's activity.

This is not hypothetical. Measured against the local development database on 2026-08-24:
114 audit rows, of which **62** are `FILE_DELETE`/`POST_DELETE`/`COMMENT_DELETE` rows
whose `targetId` collides with an existing user id. The originally reported case —
`/logs?userId=269` returning a "file 269 deleted" record while user 269 was an unrelated
account — is row `id=73`.

The polymorphism itself was undocumented: not in ADR 0013's bullet, not on the entity,
not in the query DTO. The admin console's *display* layer was corrected separately on
2026-08-24 (commit `2e88072`) with a client-side `targetLabel(action, targetId)` map in
`admin/src/lib/audit.ts`, which fixed the wrong "User N" label; that CHANGELOG entry
explicitly recorded the backend question as still open and foreclosed nothing.

## Decision

### D1 — Add `targetType`, a discriminator column beside `targetId`

A new `AuditTargetType` string enum (`backend/audit-log/audit-target-type.enum.ts`),
mirroring the `FileMediaType`/`FileVisibility` convention exactly:

```typescript
export enum AuditTargetType {
  user = 'user',
  file = 'file',
  post = 'post',
  comment = 'comment',
}
```

`AuditLogEntity.targetType` is `@Column({ type: 'varchar', nullable: true })`. It is
nullable to mirror `targetId` (already `int, nullable: true`); the invariant is
`targetType IS NULL ⟺ targetId IS NULL`, not a separately-optional field. Unlike ADR
0040's `mediaType`, there is no `SET NOT NULL` step, because the column it discriminates
is itself nullable.

`varchar` rather than an integer code, and rather than a native Postgres `enum` type, on
ADR 0013's own reasoning for `UserEntity.role`: string values keep the DB column and
Swagger readable, and a varchar column accepts a new value without an `ALTER TYPE`.

### D2 — The writer supplies the type; the reader infers nothing

`AuditLogService.log()` takes it as an explicit parameter —
`log(actorId, targetId, targetType, action, detail?)` — and each of the five call sites
passes its own constant. `findAll()`'s user branch becomes
`{ targetId: userId, targetType: AuditTargetType.user }`.

The point of routing it through the writer is that the **runtime read path now carries no
`action` → target-kind mapping at all**. In the backend that mapping exists exactly once,
in the migration's one-time backfill.

### D3 — `action` narrowed from `string` to the `AUDIT_ACTIONS` union

`targetType` and `action` are both strings and adjacent in the parameter list, so a
swapped pair would compile silently. `AuditAction`
(`backend/audit-log/dto/audit-log-query.dto.ts`, beside the existing `AUDIT_ACTIONS`
constant) narrows the fourth parameter so the two unions are disjoint and a swap becomes a
compile error. This is not incidental tightening — it is what makes D2's extra positional
parameter safe.

### D4 — Existing rows backfilled from `action`; only the new column is written

`backend/migrations/1787578451680-AddAuditLogTargetType.ts`: `ADD COLUMN` nullable, then
one `UPDATE ... SET "targetType" = CASE "action" ... END WHERE "targetId" IS NOT NULL`.
The derivation is deterministic for every historical row, because each of the five actions
is emitted by exactly one call site with exactly one target kind.

`actorId`, `targetId`, `action`, `detail`, and `createdAt` are never written — the
append-only property is preserved, and the backfill only fills the new column. The
generated diff's twelve FK/index `DROP`+`CREATE` statements were stripped as the spurious
constraint-rename noise CLAUDE.md documents.

Verified after `migration:run` against the development database: 114/114 rows backfilled,
0 remaining `NULL`, per-action distribution exactly matching the mapping; the old
predicate's 108 target-side matches drop to 46, removing all 62 false positives, while the
112 actor-side matches are unchanged. The reported case (`userId=269`) goes from 1 matched
row to 0.

## Alternatives rejected

- **Action-based query correction, no schema change** —
  `actorId = :id OR (targetId = :id AND action IN ('ROLE_CHANGE','USER_DELETE'))`, with a
  `Record<AuditAction, AuditTargetType>` constant making a new action's omission a compile
  error. This is fully correct for today's five actions, needs no migration, and touches
  three files. Rejected because it makes "`action` determines target kind" a permanent,
  load-bearing assumption rather than an observation: today the mapping is a function only
  because each action happens to have one call site and one target kind. A single future
  action that can target two kinds (a moderation action over posts *and* comments, for
  instance) breaks it, and the migration deferred here would then land on a larger table.
  Storing the discriminator alongside the reference is also the conventional shape for a
  polymorphic association, and its cost — one nullable column and a deterministic backfill
  — is at its cheapest at 114 rows.
- **Separate columns per target kind** (`targetUserId`/`targetFileId`/`targetPostId`/
  `targetCommentId`) — the most explicit option, but every new kind of target is another
  column and another migration on an append-only table, and the row's shape stops being
  uniform. Strictly more invasive than D1 for the same benefit.
- **`subjectUserId` — record which user the row concerns** — strictly more expressive than
  D1: besides removing the false positives it would also capture records the filter
  currently misses, such as an admin deleting *this user's* file. Rejected on two grounds.
  The historical rows cannot be backfilled at all — the file, post, or comment is gone, so
  its owner is unrecoverable, leaving the column permanently `NULL` for all 114 existing
  rows. And it widens what `userId` returns, which is a behavior change beyond the defect
  being fixed. It stays available as a later, separately-decided addition, and D1 does not
  block it.
- **Normalize `targetId` to always hold a user id, moving the resource id into `detail`** —
  removes the polymorphism at its source rather than describing it. Rejected on the
  append-only constraint: making it true for the existing rows means rewriting their
  `targetId`, which this table forbids, and *not* rewriting them leaves old and new rows
  meaning different things under the same column name.

## Consequences

- `GET /audit-log?userId=N` now means "N was the actor, **or** N was the target of a
  user-targeting action". A record whose target is a file, post, or comment matches only
  through the actor side. This is a deliberate behavior change: the admin console's
  "Recent activity" panel returns fewer rows, and the ones it drops were wrong.
- The API response gains a `targetType` field on every record — the endpoint returns
  entities directly, so this is additive and existing clients ignore it. It also makes
  `admin/src/lib/audit.ts`'s client-side `TARGET_NOUN` map redundant: the console *may*
  read the server field instead. That is optional cleanup, deliberately left outside this
  change.
- ADR 0013's audit-log bullet is amended — `targetType` joins its column list, and the
  polymorphism it never mentioned is recorded here.
- **Deploy ordering is load-bearing.** The code both writes and reads `targetType`, so the
  migration must run before the new code — already this project's stance ([ADR
  0032](0032-migration-as-separate-deploy-step.md)). A row written by *old* code after the
  migration would carry a `NULL` `targetType` and, if it were a `ROLE_CHANGE`/
  `USER_DELETE`, would be missed by the target branch. There is no deploy pipeline in this
  repo, so this is a recorded consequence rather than an action item.
- No index was added. `actorId`, `targetId`, and `targetType` still have none — the
  entity's only index remains `(action, createdAt)`. Accepted at this volume, as it was
  when the `userId` filter landed.
- The `action` → target-kind knowledge now lives in exactly two write-once places: the
  migration's backfill `CASE` for historical rows, and the five call sites for new ones.
  The read path has none, so a future action cannot silently reintroduce the false positive
  by being omitted from a lookup table.

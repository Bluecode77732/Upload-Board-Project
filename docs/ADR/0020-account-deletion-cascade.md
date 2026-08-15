# ADR 0020: Deletion Policy — Confirmed Account Cascade over Soft Delete

- Status: Accepted
- Date: 2026-07-30
- 한국어: [0020-account-deletion-cascade.ko.md](0020-account-deletion-cascade.ko.md)

## Context

ROADMAP Stage 2 carries one design task uniting two questions: whether this project
adopts soft delete, and what `DELETE /user/:id` should do when the account owns files.
Tracing the code turned up a third problem that was documented nowhere:

| Path | Behavior before this ADR |
|---|---|
| `DELETE /user/:id` for an account owning files | `userRepository.delete(id)` → Postgres `23503` foreign-key violation → not an `HttpException` → **500 `INTERNAL_ERROR`**, message "Internal server error" |
| `DELETE /file/:id` | Deletes the row only. The stored `granted_` file is **never unlinked** — it stays on disk forever and stays publicly served by `ServeStaticModule` |

The FK is `FK_file_entity_creator ... ON DELETE NO ACTION` (baseline migration), and
`FileEntity.creator`'s `cascade: true` is TypeORM's *persist* cascade — it propagates
saves, not deletes, so it contributes nothing here. The orphaned-file leak is the exact
mirror of the one [ADR 0018](0018-orphan-temp-file-cleanup.md) closed for `temp_` files,
except no sweep covers `file/upload`: the sweep's premise is that a `temp_` file in
`file/temp` is unclaimed, which says nothing about a promoted file whose row is gone.

## Decision

**Deletion stays hard, and an account is deleted together with the files it owns — but
only on an explicit confirmation carried by the request.** Soft delete is *not* adopted.

- **`DELETE /user/:id?deleteFiles=true`** cascades: the account's file rows, then the
  account row, then the stored files.
- **Without that confirmation**, an account that still owns files is refused with
  **409 `USER_HAS_FILES`** (new code), whose message carries the file count. The refusal
  destroys nothing and is idempotent. `deleteFiles=false` is treated exactly like an
  absent flag.
- The confirmation is a **backstop, not a required round trip**: a client that has already
  warned the user sends the flag on the first request and never sees the 409. The 409
  exists so a request that skipped the warning — curl, a script, another client — cannot
  destroy files silently.
- **An account owning no files deletes exactly as before**, with or without the flag.
- **Admins follow the same rule.** RBAC already allows "self or admin" here; the cascade
  is not further restricted, and the audit row records it.
- **`DELETE /file/:id` now unlinks the stored file** after deleting the row, closing the
  leak above.

Mechanics that are part of the decision, not incidental:

- **Transaction pattern**: `dataSource.transaction()` (transaction-pattern table row 3).
  The boundary holds pure DB writes; the filesystem side effect is deliberately *outside*
  it, so no manual QueryRunner is needed.
- **Unlink happens after the commit.** `unlink` cannot be rolled back. Inside the boundary,
  a commit failure would leave a row-less file — irrecoverable. Outside it, an unlink
  failure leaves an orphan on disk — recoverable, and the pre-existing status quo. The
  irreversible step is therefore always last. (This is the mirror image of `uploadFile`,
  where `rename` sits *inside* the boundary: a failed rename leaves the file in `file/temp`,
  which matches the rolled-back state exactly.)
- **File rows stay FileModule's responsibility.** `UserService` owns the transaction and
  passes its `EntityManager` to `FileService.findStoredPathsOfCreator` /
  `deleteFilesOfCreator`; `FileModule` now exports `FileService` and `UserModule` imports it.
  `UserService` never touches `FileEntity` itself (Module Responsibility).
- **Rows are deleted by `creatorId`, not by the id list just read.** A file inserted
  between the read and the delete would otherwise survive and re-trigger the FK violation.
  The residual is that such a file's stored bytes are not in the unlink list — an orphan,
  not a broken row.
- **The confirmation flag is a string literal, not a boolean.** Measured, not assumed:
  under the global pipe's `enableImplicitConversion`, the Boolean cast is pure truthiness
  and lands *before* any custom `@Transform`, so a boolean-typed field turns
  `?deleteFiles=false` into `true` — the flag would fire against the caller's stated
  intent. `DeleteUserQueryDto` therefore declares `deleteFiles?: 'true' | 'false'` with
  `@IsIn`, and the controller narrows it. `delete-user-query.dto.spec.ts` asserts this
  through the real pipe configuration so the hazard cannot silently return.
- **No schema change.** The FK keeps `ON DELETE NO ACTION`; the cascade is explicit in the
  service, which is also where the paths needed for unlinking are read.

## Alternatives rejected

- **Soft delete (`@DeleteDateColumn` on User/File)** — the recoverable option, and it would
  make the FK problem vanish structurally. Rejected: it is a schema change on two
  high-blast-radius entities plus a `withDeleted` policy for every query; the unique
  constraints on `user.email` and `file.title` keep binding for soft-deleted rows, so a
  deleted title or email can never be reused; a soft-deleted file's bytes stay on disk and
  **stay publicly served** (authenticated playback is a Stage 4 item), so "deleted" content
  would remain watchable by anyone holding the URL; and it would contradict the
  right-to-erasure reading `DELETE /user/:id` currently carries. Reconsider only with a
  concrete recovery requirement — it would need its own ADR and migration.
- **Ownership transfer to a placeholder account** — keeps the files, but invents a
  placeholder identity to seed and maintain, and misattributes content whose real owner
  asked to be removed.
- **Unconditional cascade (no flag)** — the smallest diff and exactly the intended flow
  when the frontend behaves. Rejected because the warning would live only in the frontend:
  a single stray request from any other client would irreversibly destroy an account's
  entire library with no signal in between.
- **Refuse always (409, no cascade path)** — safest and cheapest, and it does define the
  behavior. Rejected as the whole answer: it makes "delete my account" a multi-step chore
  and, for a user who wants their data gone, leaves the data behind.
- **Restricting the cascade to self-deletion (admins always 409)** — one step more
  conservative, but it makes routine operational cleanup (a spam account with many files)
  an N+1 request sequence for no security gain: an admin can already delete those files one
  by one, and the audit row records the cascade either way.

## Consequences

- `DELETE /user/:id` gains two outcomes a client must handle: **409 `USER_HAS_FILES`** and
  **400 `VALIDATION_FAILED`** for a flag that is neither `"true"` nor `"false"`.
  `USER_HAS_FILES` is added to the frozen catalog ([ADR 0011](0011-error-code-contract.md));
  adding a code is not a breaking change.
- **The confirmed path is irreversible**: file rows, the account row, and the stored bytes
  are all gone, with no recovery path. The audit trail survives (`audit_log_entity` has no
  FKs by design — [ADR 0013](0013-rbac-and-audit-log.md)); `USER_DELETE` now carries
  `detail: files=N`.
- **Frontend adoption is a frontend-scoped task, explicitly out of this change.** The
  warning dialog, the `deleteFiles=true` retry, and the 409 branch belong to `frontend/`,
  which carries its own scoped CLAUDE.md (CLAUDE.md > Project Overview). Until that lands,
  the frontend has no delete-account flow that can pass the confirmation.
- **An unlink failure is now a logged warning, not an error.** `FileService` and
  `UserService` gained a `Logger` for it (`warn` = degraded, [ADR 0017](0017-logging-conventions.md)).
  Orphaned `file/upload` bytes are therefore possible in two narrow cases — a failed unlink
  and the concurrent-insert race above — and nothing sweeps that folder. A `granted_` sweep
  is deliberately not introduced here: unlike `file/temp`, "on disk without a row" cannot be
  decided from the filename alone, so it needs a DB-joined design of its own.
- `unlinkStoredFiles` (`backend/common/`) refuses any path outside `file/upload/`. That
  guard is reachable, not defensive padding: `UpdateFileDto` accepts a bare `granted_` name
  with no folder, so a row can legitimately hold such a path — and an unlink must never
  follow one out of the storage root.
- `UserModule` → `FileModule` is a new module edge (no cycle: `FileModule` depends on the
  `UserEntity` repository, not on `UserModule`).
- The dev-time convenience of "just delete that test user" is gone when the user owns
  files; the flag is now part of the request.

# ADR 0067: Ownership transfer moves out of `FileService` into `FileTransferService`

- Status: Accepted — implemented; no schema, API or behavior change
- Date: 2026-10-14
- Relates to: [ADR 0050](0050-consent-based-file-ownership-transfer.md) (the transfer flow itself), [ADR 0023](0023-board-domain-schema.md) D4 (FileModule answers questions, never imports its askers)
- 한국어: [0067-file-transfer-service-split.ko.md](0067-file-transfer-service-split.ko.md)

## Context

`backend/file/file.service.ts` had reached 1,024 lines with 13 public methods. About 200 of those
lines were the four write methods of the ownership-transfer flow (`proposeTransfer`,
`acceptTransfer`, `rejectTransfer`, `cancelTransfer`, ADR 0050). Read from the code on 2026-10-14:

- The four methods share no state with the rest of the class. They use `fileRepository`,
  `userRepository` (propose only), `auditLogService` (accept only), a creator-or-admin check
  (propose only), a "read the row or 404" step, and `toResponse`.
- The only caller is `FileController`'s four `/file/:id/transfer…` handlers.
- `userRepository` had no other use in `FileService`.

The question was how to separate them, not whether: a new module, a new service in `FileModule`,
or leaving them.

## Decision

### D1 — A new `FileTransferService`, in `FileModule`, not exported

`backend/file/file-transfer.service.ts` holds the four methods, moved with their bodies and
목적/이유/방법 comments unchanged. It is a provider of `FileModule` and is not in `exports`:
`FileController` is its only caller and no other module has been promised anything.

### D2 — It depends on `FileService` through `toResponse` only

`toResponse` is already public (PostService uses it), so `FileService`'s public surface does not
change. Two small things are copied into the new service instead of being made public:

- `canManage`, four lines. PostService and CommentService already each keep their own.
- the "read the row with `creator` and `pendingTransferTo`, else 404 `FILE_NOT_FOUND`" step, as a
  private `loadWithPending(id)`.

`FileService` no longer injects `userRepository`.

### D3 — The read side stays in `FileService`

`toResponse` (when `pendingTransferTo` is shown) and `getFileById` (who may see a pending file)
are read paths that other callers share. Moving them would pull `PostService` into the change.

### D4 — Routes stay on `FileController`

The four handlers keep their paths, guards, throttles and Swagger text; only the call target
changes. Two Swagger descriptions that named `file.service.ts` now name
`file-transfer.service.ts`.

## Consequences

- `file.service.ts` goes from 1,024 to about 820 lines; the new service is 248 lines with
  comments.
- Tests: the four transfer `describe` blocks moved verbatim to `file-transfer.service.spec.ts`
  (17 cases). `file.service` plus `file-transfer.service` give 91, the count before the split. The
  new spec runs against the real `FileService` so response assertions are unchanged.
- The creator-or-admin rule now exists in four services (File, FileTransfer, Post, Comment). A
  change to that rule has to be made in each. This was already true for three.
- ADR 0050 names `file.service.ts` and `file.service.spec.ts` as where things live. Its text is
  left as written; this ADR is the pointer.
- Verified: unit 282/282, backend e2e 76/76 (HTTP + real Postgres, includes transfer and
  accept). The real-server Playwright run was not done for this change: port 3000 was held by
  another project's process on the machine.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Leave it in `FileService` | The file stays the largest in the repo, and a change to transfer rules sits in the same file as upload and visibility logic |
| A separate `FileTransferModule` | It needs `FileService.toResponse`, so it imports `FileModule`; `FileController` (in `FileModule`) needs it, so `FileModule` imports it back — a cycle. One caller does not justify a module |
| Make `canManage` and the loader public on `FileService` | Widens the contract every consumer sees, to save about 20 lines |
| Split `toResponse` into its own mapper | Pulls `PostService` and `UserService` into the change; the goal here is file size |

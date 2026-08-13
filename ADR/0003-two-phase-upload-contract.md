# ADR 0003: Two-Phase Upload with `temp_` → `granted_` Prefix State Machine

- Status: Accepted
- Date: 2025-12-17
- 한국어: [0003-two-phase-upload-contract.ko.md](0003-two-phase-upload-contract.ko.md)

## Context

A single-request upload (multipart + metadata together) couples the physical write and
the DB row: if metadata validation fails after the file lands, an orphan file remains;
if the file write fails after the insert, the row points at nothing. It also merges two
concerns (physical storage vs. metadata) that this project deliberately splits across
`UploadModule` and `FileModule`. A file also needs a visible lifecycle state, because
`ServeStaticModule` exposes the whole `file/` tree.

## Decision

Upload is two requests with a prefix state machine:

1. `POST /upload/attach` — Multer diskStorage writes
   `file/temp/temp_{uuid}_{timestamp}.{ext}` and returns only the generated filename.
   `temp_` means "uploaded but unclaimed".
2. `POST /file` — inside one QueryRunner transaction, inserts the
   `FileEntity` row with `filePath = file/upload/granted_...` and physically renames
   the file from `file/temp` to `file/upload`. `granted_` means "owned by a DB row".
   (2026-07-23: metadata route canonicalized to `POST /file` —
   [ADR 0010](0010-frontend-split-and-api-surface-freeze.md).)

`UpdateFileDto.filePath` rejects `temp_` values and accepts only `granted_` ones.
Filenames are always server-generated (uuid + timestamp); the client only echoes them
back — no client-chosen path segment ever reaches the filesystem.
(2026-07-27: that echo is now *enforced* rather than assumed — `UploadFileDto.filePath`
carries `@Matches(TEMP_FILENAME_PATTERN)`, and the filename doubles as a one-shot claim
token that defines the duplicate-submission behavior —
[ADR 0019](0019-upload-claim-idempotency.md).)

## Consequences

- The prefix is the only lifecycle marker visible to static serving; every consumer of
  `filePath` must preserve the state machine end to end.
- Orphaned `temp_` files (attached but never claimed) accumulate. (2026-07-26: resolved
  — a scheduled sweep deletes `temp_` files past a TTL, [ADR 0018](0018-orphan-temp-file-cleanup.md).)
- The DB insert + rename pairing is why `FileService` uses the manual QueryRunner
  pattern (see [ADR 0004](0004-transaction-pattern-selection.md)).
- Path traversal is prevented by construction, not by sanitization. (2026-07-27: this
  held for the *generated* name but was never checked on the way back in — an unvalidated
  `filePath` reached `rename` as a source, so a `../` segment could register a row pointing
  at another user's `granted_` file. Closed by the DTO pattern in
  [ADR 0019](0019-upload-claim-idempotency.md).)
- Duplicate submission was left undefined here. (2026-07-27: defined —
  [ADR 0019](0019-upload-claim-idempotency.md) makes the attach-issued filename a one-shot
  claim token: a resubmit replays for its claimant, 409s for anyone else.)

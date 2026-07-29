# ADR 0019: Upload Duplicate-Submission Policy — the Attach Filename as a One-Shot Claim Token

- Status: Accepted
- Date: 2026-07-27
- 한국어: [0019-upload-claim-idempotency.ko.md](0019-upload-claim-idempotency.ko.md)

## Context

CLAUDE.md requires every write endpoint to state its duplicate-submission behavior
(Engineering Principles > Maintainability > Idempotence), and Stage 3 will multiply write
endpoints, so the frame has to be settled first (ROADMAP Stage 2). The two-phase upload
([ADR 0003](0003-two-phase-upload-contract.md)) had no such statement, and tracing the
actual code showed the undefined behavior was not merely undocumented but wrong in three
places:

| Duplicate submission | Behavior before this ADR |
|---|---|
| `POST /upload/attach` twice | Two `temp_` files, both 201 — one is orphaned |
| `POST /file` retried with the identical body after the first succeeded | 400 `FILE_TITLE_TAKEN` — indistinguishable from "another user took the title" |
| `POST /file` with the same `filePath` but a different title | insert succeeds → `rename` throws `ENOENT` → rollback → **500** |
| Two simultaneous `POST /file` with the same title | the unlocked title pre-check lets both through; the loser's `QueryFailedError` is not an `HttpException` → **500** |
| `POST /file` with a `filePath` attach never issued | `rename` `ENOENT` → **500** |

`UploadFileDto.filePath` also had no format validation while flowing into
`join(cwd, 'file/temp', filePath)` as a rename source, so a client-supplied `../` segment
could register a `FileEntity` row pointing at another user's `granted_` file — the
"filePath values are server-constructed" premise (Never Do Group 3) was unenforced.

## Decision

**The attach-issued filename is a one-shot claim token.** No new storage, no schema
change: `temp_{uuid}_{ts}.{ext}` is already a server-generated, per-request unique value,
and the presence of a `FileEntity` row whose `filePath` is its `granted_` form *is* the
record that the claim was spent.

- **`POST /upload/attach` stays deliberately non-idempotent.** Each call issues a new
  token; an unclaimed one is reclaimed by the scheduled sweep
  ([ADR 0018](0018-orphan-temp-file-cleanup.md)). Deduplicating bytes was rejected (below).
- **`POST /file` resolves a claim before opening a transaction:**
  - already claimed by the **same** user → **200** with the existing resource (idempotent
    replay; a retry must not read as a second creation),
  - already claimed by a **different** user → **409 `FILE_ALREADY_CLAIMED`** (new code).
    Deliberately identity-only — an admin re-posting someone else's filename is a
    conflict, not a retry; RBAC governs *managing* a file, never *claiming* one,
  - well-formed but no temp file behind it (never issued, or swept past its TTL) →
    **400 `FILE_INVALID_PATH`**, checked before any write rather than surfacing as a 500.
- **The concurrent double-submit is resolved by the DB, not by a lock.** The title
  pre-check is an unlocked read; when simultaneous submits race, the unique constraint
  picks a winner and the loser's `23505` is re-examined: if the winner claimed the same
  filename, the loser is the same request twice and is replayed; otherwise it is a genuine
  title collision → 400 `FILE_TITLE_TAKEN`. A 500 for a foreseeable client sequence is
  gone in both directions.
- **`filePath` is pinned to the issued shape** via `@Matches(TEMP_FILENAME_PATTERN)` on
  `UploadFileDto` — `^temp_{uuid}_{ms}\.(mp4|mov|webm)$`, case-insensitive because the
  stored extension keeps the original filename's casing. Malformed input is rejected at
  the boundary as 400 `VALIDATION_FAILED` by the global pipe (validation stays on the DTO,
  not in the service), which closes the path-traversal gap by construction.
  `UpdateFileDto` **omits** the inherited `filePath` and redeclares it: the two endpoints
  sit on opposite sides of the prefix state machine (`temp_` in, `granted_` out), so
  inheriting the pattern would reject every legitimate update.
- **Transaction pattern unchanged** — manual QueryRunner (transaction-pattern table row 2):
  the non-DB side effect (`rename`) still sits inside the boundary. The claim pre-check and
  the temp-existence check are reads placed *before* the transaction so a retry opens no
  connection at all.

## Alternatives rejected

- **`Idempotency-Key` header** — the general solution and the only one that also covers
  future write endpoints, but it needs a key↔response table (schema change + migration),
  in-flight state and TTL cleanup, and header parsing outside the global `ValidationPipe`.
  Its key would duplicate a token the server already issues. Reconsider when Stage 3 adds
  write endpoints that have no natural token.
- **Content-hash dedup** — the only option that removes the duplicate bytes, but "same
  bytes" is not "same request": it leaves every retry behavior above unfixed, entangles
  ownership when two users upload the same clip, and breaks ADR 0018's premise that a
  `temp_` file in `file/temp` is unclaimed and safe to delete.
- **Documentation only (no code)** — zero cost, but it would freeze "concurrent submit
  returns 500" into the written contract, and leave the `filePath` validation gap open.

## Consequences

- `POST /file` can now answer **200** (replay) as well as 201; the controller sets the
  status from the service's `replayed` flag via `@Res({ passthrough: true })` — the same
  pattern `AuthController` already uses for cookies. `FileService.uploadFile` returns
  `{ replayed, file }` instead of a bare `FileResponseDto`.
- `FILE_ALREADY_CLAIMED` (409) is added to the frozen error-code catalog
  ([ADR 0011](0011-error-code-contract.md)); adding a code is not a breaking change, but
  409 is a new status for this API and frontend clients must handle it.
- **Frontend adoption is a frontend-scoped task, explicitly out of this change.**
  `frontend/docs/API-CONTRACT.md` and the client upload flow must both take up the new
  200-replay and 409 outcomes; until they do, the frontend reads a replay as a fresh
  creation and has no 409 branch. This change stopped at the repo boundary because
  `frontend/` carries its own scoped CLAUDE.md and tooling (CLAUDE.md > Project Overview:
  do not edit frontend files from a backend task). Tracked in ROADMAP §7.
- A malformed `filePath` now fails as `VALIDATION_FAILED` at the pipe rather than reaching
  the service — the error code differs from the service-thrown `FILE_INVALID_PATH`, which
  is reserved for a well-formed but unusable filename.
- Duplicate `attach` calls still cost disk until the sweep runs: bounded by
  `TEMP_SWEEP_TTL_HOURS` × the 100 MB cap, accepted deliberately rather than deduplicated.
- The replay path trusts the DB row, not the original response body — the resubmitted
  `title` is ignored on a replay. That is intended (the first claim won), and it means a
  client that retries with a *changed* title gets the original title back, not a 400.
- The `23505` check reads the Postgres driver error code, a small, deliberate coupling to
  the driver already fixed by `DB_TYPE=postgres`.

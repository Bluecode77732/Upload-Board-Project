# ADR 0065: Multi-file upload is the client repeating the one-file request; the backend keeps one file per request

- Status: Accepted — implemented in `frontend/` (`UploadForm.tsx`); verified 2026-10-06 against the local compose stack (Playwright e2e)
- Date: 2026-10-06
- Relates to: [ADR 0003](0003-two-phase-upload-contract.md) (the two-phase contract this repeats per file), [ADR 0019](0019-upload-claim-idempotency.md) (the per-file claim that keeps working unchanged), [ADR 0027](0027-media-type-expansion-implementation.md) ("exactly one of `image`/`audio`/`video`" per request, left as is), [ADR 0054](0054-per-route-rate-limit-tuning.md) (the 15/minute attach limit that sets the batch size), [ADR 0023](0023-board-domain-schema.md) (one file per post, out of scope here)
- 한국어: [0065-multi-file-upload-client-sequential.ko.md](0065-multi-file-upload-client-sequential.ko.md)

## Context

`POST /upload/attach` takes one file per request: each of the three fields is registered with
`maxCount: 1` and the handler rejects more than one populated field (`backend/upload/upload.controller.ts`).
The upload form mirrored that. It had one title, one type radio and one file input, so a user with
four files went through the form four times.

No earlier ADR weighed multi-file upload. The one-file shape came with the original single `video`
field, and ADR 0025 D5 / ADR 0027 kept "exactly one" when they widened it to three fields. This ADR
is the first time the question is decided on purpose.

What the backend does today, checked against the local compose stack on 2026-10-05 with a throwaway
account:

| Attempt | Result |
|---|---|
| Two files in the same field (`image` + `image`) | 400 `BAD_REQUEST`, "Unexpected field - image" |
| `image` + `audio` + `video` in one request | 400 `UPLOAD_MULTIPLE_FIELDS` |
| Three separate attach requests | 201 each |
| `POST /file` for each of those three | 201 each, `mediaType` image / audio / video |
| The 16th attach within a minute | 429 (rejected requests count too) |

So several files already upload today, as long as each one is its own request.

## Decision

### D1 — The backend keeps one file per request; the client repeats the request per file, one at a time

The form lets the user pick several files at once and then runs attach → promote for each file in
turn. Nothing in `backend/` changes and the API contract is the same.

The reasons, in the order they weigh:

- The backend already receives, scans, names and registers one file per request. Repeating that
  request is all multi-file upload needs, so the server has nothing to fix.
- One file failing (a rejected scan, a taken title, a dropped connection) ends on that file. The
  others are unaffected and only that one is sent again.
- Uploads are buffered in memory (`memoryStorage`, ADR 0029 D4). With one file per request, a
  request never holds more than one file's bytes, at most 100 MB.

Sending is sequential, not parallel, so one request is in flight at a time.

### D2 — The file's kind comes from its extension, not from a choice the user makes

The type radio is removed. `UploadForm.tsx` maps the extension to the `image`/`audio`/`video` field
per file, so one selection can mix kinds. A file whose extension is not on the list is marked on its
own row before anything is sent.

This is a fourth place that lists the accepted extensions, next to the three backend lookups ADR
0040 D6 names. Accepting a new extension means updating `FIELD_BY_EXTENSION` in `UploadForm.tsx` too.

### D3 — One title per file, defaulting to the original file name; a collision is fixed on its row

`FileEntity.title` is unique, so every file needs its own title. The default is the file name without
its extension, used as is. A collision comes back as 400 `FILE_TITLE_TAKEN` on that row; the user
edits the title and presses Upload again. The file is already in temp storage by then, so only the
promote step is retried and the bytes are not sent a second time.

### D4 — At most 15 files per selection

Attach is limited to 15 requests a minute (ADR 0054) and one file is one request. A selection over 15
is refused before anything is sent. If a 429 still comes back mid-run (earlier uploads in the same
minute), the run stops there and the remaining rows stay for a later press.

### D5 — A post still references at most one file

Attaching several files to one post is not part of this. `PostEntity.file` is one-to-one and its
unique constraint is also the idempotency key of `POST /post` (ADR 0023 D1/D4), so lifting it is a
schema change with its own decision to make. The two are independent: this ADR does not have to be
revisited when that one is taken up.

## Alternatives rejected

- **The backend accepts several files in one request.** It would raise `maxCount`, return an array of
  filenames and amend ADR 0025 D5 / ADR 0027. Rejected: a request's peak memory would grow with the
  number of files (files × 100 MB) and need a total cap; a response for "some succeeded, some failed"
  would have to be designed; scan time for every file would add up inside one request; and at this
  project's scale fewer requests buys nothing. The per-file claim (ADR 0019) would survive either
  way, so idempotency was not a reason for or against.
- **Add a suffix to a default title automatically** so it rarely collides. Rejected: the title is
  what users see in the list, and a generated tail makes it worse to read. A collision is shown on
  the row and takes one edit to fix.

## Consequences

- No backend change, no schema change, no new error code. `frontend/docs/API-CONTRACT.md` only gains
  a note on how the client uses the two calls.
- A batch takes the sum of its files' upload and scan times, and one press uploads at most 15 files.
  Accepted at this scale.
- Uploaded files are independent rows. Nothing groups a selection into an album or a post.
- Leaving the page mid-run keeps the files that finished and drops the rest.
- Attach itself is not deduplicated: a re-sent attach creates another temp file, removed by the
  sweep after `TEMP_SWEEP_TTL_HOURS` (ADR 0018, ADR 0019 Consequences). The promote step is: a
  repeated `POST /file` replays as 200.
- Two files in the same field still answer with the fallback code `BAD_REQUEST`, not a typed one.
  The form never sends that, so it is left as is.
- The unclaimed-filename gap in the ADR 0019 Addendum (2026-10-06) is unchanged by this.
- Per-file requests are also the common default elsewhere: Uppy's XHR uploader sends each file in
  its own request unless `bundle` is turned on ([Uppy docs](https://uppy.io/docs/xhr-upload/)).

Verified 2026-10-06 against the local compose stack (`api`, `db`, `clamav`) with the Vite dev server:

- `e2e/upload.spec.ts`, 3 tests: a single video; a duplicate title failing on its row and then
  succeeding after the title is edited, with exactly one attach request; an image, an mp3 and a
  video chosen together becoming three uploaded rows from three attach requests.
- `e2e/upload-select.spec.ts`, 3 tests on a stubbed API: kind and default title per row, an
  unsupported extension, the 15-file cap and its Korean message.
- `e2e/board.spec.ts`, `detail.spec.ts`, `posts.spec.ts` (10 tests) pass with the new form through a
  shared helper, and the 16 stub-based UI tests pass. `navigation.spec.ts`'s two `/files` checks now
  look for the form's heading, since a Title box exists only after a file is chosen.
- `pnpm build` and `pnpm lint` pass in `frontend/`.

The local API runs with rate limiting on, so the real-backend specs were run in batches a minute
apart to stay under the 5/minute sign-up limit. They were not run as one `pnpm test:e2e`. Run
together, two of `navigation.spec.ts`'s direct-load tests land on the sign-in screen; they do the
same on the tree before this change, and each passes when run alone.

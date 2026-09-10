# ADR 0027: Media-Type Expansion Implementation — Type-Specific Upload Fields

- Status: Accepted
- Date: 2026-08-01
- 한국어: [0027-media-type-expansion-implementation.ko.md](0027-media-type-expansion-implementation.ko.md)

## Context

[ADR 0025](0025-file-visibility-and-media-expansion.md) was a design gate (no code)
covering six decisions (D1–D6). [ADR 0026](0026-file-visibility-implementation.md) landed
D1/D2/D3/D6 (visibility, access-controlled serving, share tokens). D4 (expanded allowlist)
and D5 (type-specific upload fields) were explicitly left for this separate task — ADR
0026's Context says so directly, and CLAUDE.md's Known Gaps tracked it as still-pending
after that commit.

Before this change, `POST /upload/attach` accepted a single multipart field named `video`
with an mp4/mov/webm-only allowlist (`backend/upload/upload.controller.ts`). Images and
audio were rejected outright, leaving founding goal 4 ("images, video, mp3, mp4 within
100 MB") partially unmet.

## Decision

### Three named fields on one route, not three routes or one generic field

`POST /upload/attach` now accepts one of three multipart fields — `image`, `audio`,
`video` — each with its own class allowlist, exactly as ADR 0025 D5 specified. The route
and the response shape (`{ filename }`) are unchanged.

Implementation shape: `FileFieldsInterceptor` (not three stacked `FileInterceptor`s — a
multipart body can only be parsed once, so three field-specific interceptors on one route
is not an option Nest/Multer supports) registers all three field names
(`[{name:'image',maxCount:1}, {name:'audio',maxCount:1}, {name:'video',maxCount:1}]`) with
one shared `fileFilter`. The filter branches on `file.fieldname` — client-supplied, so it
is looked up in a small `Map<string, allowlist>` rather than trusted with a type cast — to
apply that field's own extensions/mimetypes:

| Field | Extensions | Mimetypes |
|---|---|---|
| `image` | jpg, jpeg, png, webp | image/jpeg, image/png, image/webp |
| `audio` | mp3 | audio/mpeg |
| `video` | mp4, mov, webm | video/mp4, video/quicktime, video/webm |

All three stay under the existing 100 MB ceiling ([ADR 0005](0005-local-disk-storage.md)) —
D4 did not change the size limit, only the type allowlist.

### Exactly one field, enforced in the controller, not by Multer alone

`FileFieldsInterceptor` accepts any combination of the three registered fields — Multer has
no built-in "exactly one of N fields" constraint. The handler counts how many of the three
came back populated (via `@UploadedFiles()`, not the old `@UploadedFile()`) and throws a
typed 400 either way: zero files reuses the existing `UPLOAD_FILE_REQUIRED` (the "attach
something" outcome is unchanged from the single-field version), more than one is a new
`UPLOAD_MULTIPLE_FIELDS`. Per the [ADR 0011](0011-error-code-contract.md) catalog
convention, the code is added at its throw site rather than pre-reserved.

A client sending two fields where the second is also the wrong type for its field observes
`UPLOAD_INVALID_TYPE` instead, because Multer's `fileFilter` runs per-file as the multipart
body streams in and rejects on the first failure — the multi-field check never gets a
chance to run first in that case. Both are 400s with a typed code, so this ordering is not
worth adding buffering/reordering logic to normalize (YAGNI).

### `upload.module.ts`'s Multer `diskStorage` is untouched

The `temp_{uuid}_{timestamp}.{ext}` filename generator (`upload.module.ts`) reads the
extension off `file.originalname`, never the field name — so a fourth upload class could be
added tomorrow without touching that file. This task changes only
`upload.controller.ts`'s interceptor configuration and Swagger body schema; the storage
config classified as high-blast-radius in CLAUDE.md (Scope Discipline) was read, not
edited.

### Two extension allowlists elsewhere had to widen in step

Two other places encode "which extensions are valid," both keyed off extension rather than
field name (so unaffected by D5's field split, but directly affected by D4's expanded
class list):

- `TEMP_FILENAME_PATTERN` (`backend/file/dto/create-uploadFile.dto.ts`) — validates the
  `filePath` a client echoes back to `POST /file`, and doubles as the one-shot claim token
  ([ADR 0019](0019-upload-claim-idempotency.md)). Its extension group widened from
  `(mp4|mov|webm)` to `(jpg|jpeg|png|webp|mp3|mp4|mov|webm)`. Without this, `POST /file`
  would 400 `VALIDATION_FAILED` on every image/audio promotion despite `POST /upload/attach`
  having just accepted the same file — the two endpoints would disagree about what upload
  succeeded.
- `CONTENT_TYPE_BY_EXTENSION` (`backend/file/file-content.controller.ts`) — the
  `Content-Type` lookup `GET /file/:id/content` ([ADR 0026](0026-file-visibility-implementation.md))
  emits when streaming bytes. Its own header comment already flagged this as the
  video-only mirror of `upload.controller.ts`'s allowlist, pending this task. Gained the
  five new extension→mimetype rows; no other change to that controller's serving logic.

Neither file's *mechanism* changed — both were already generic, extension-keyed lookups.
Only their data widened, in the same change as the field split, because shipping D5 without
these two would accept an image/audio upload at step one and then reject or mis-serve it at
step two or three.

## Alternatives rejected

Recorded already in [ADR 0025](0025-file-visibility-and-media-expansion.md)'s Alternatives
rejected section (single generic field, per-class routes) — not re-litigated here; D5 already chose the
type-specific-fields shape. The one implementation-level choice ADR 0025 left open was
*how* to enforce "exactly one field" server-side, resolved above.

## Consequences

- **No schema change.** This task touches upload validation only — `FileEntity` is
  unaffected, no migration.
- **New error code** `UPLOAD_MULTIPLE_FIELDS` (400), added where it is thrown
  (`UploadController.uploadMedia`), per the ADR 0011 catalog convention.
- **`@ApiBody` now documents three optional binary properties** (`image`/`audio`/`video`)
  instead of one required `video` field, with a description noting exactly one is expected;
  the 400 `@ApiResponse` description lists all three new failure shapes.
- **Breaking change against a live consumer**, exactly as ADR 0025 D5 already flagged: the
  `video`-only field is gone. `frontend/docs/API-CONTRACT.md` and the upload view still
  target the old single-field shape and need their own, separate frontend-scoped task
  (CLAUDE.md > Project Overview) — this task stops at the repo boundary.
- **Test coverage**: `test/app.e2e-spec.ts` gained four cases in the two-phase-upload
  describe block — an image round trip (attach → promote → content `Content-Type:
  image/jpeg`), an audio round trip (same, `audio/mpeg`), a wrong-type-for-field rejection,
  and a two-fields-at-once rejection. The existing video-path tests were untouched and still
  pass unmodified, since `video` stays a valid field name for mp4/mov/webm. No unit-test
  changes — `upload.controller.ts` is a controller, excluded from coverage by the existing
  Jest config (Testing conventions).
- **CLAUDE.md's File Storage section** is updated in the same change to describe the landed
  three-field allowlist instead of the "decided but not yet built (D4/D5)" gate language,
  since D4/D5 are now both implemented.

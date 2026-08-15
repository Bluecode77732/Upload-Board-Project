# ADR 0040: Persisted `mediaType` Column for Playback Tag Selection

- Status: Accepted
- Date: 2026-08-16
- Extends: [ADR 0025](0025-file-visibility-and-media-expansion.md) D4/D5 and
  [ADR 0027](0027-media-type-expansion-implementation.md) (those decided which
  extensions/mimetypes `POST /upload/attach` accepts; this ADR decides that the
  resulting class is persisted and how a consumer picks a playback tag from it) —
  does not amend either, no prior decision is changed
- 한국어: [0040-persisted-media-type-for-playback.ko.md](0040-persisted-media-type-for-playback.ko.md)

## Context

ADR 0025 D4/D5 and ADR 0027 widened `POST /upload/attach` to accept three
type-specific multipart fields (`image`, `audio`, `video`), each with its own
extension/mimetype allowlist. That work never persisted which class a given
upload belonged to — `FileEntity` and `FileResponseDto` carry only `filePath`
(and, implicitly, its extension). `frontend/src/features/files/FileDetailPage.tsx`
and `frontend/src/features/posts/PostDetailPage.tsx` both render a bare
`<video controls>` for every file's content unconditionally, because neither has
any field to branch on. An uploaded jpg or mp3 is fully reachable through
`GET /file/:id/content` (ADR 0025/0026) — the bug is purely presentational: a
`<video>` element cannot display an image, and while some browsers can decode an
mp3 through a `<video>` tag, it renders as a blank/dead player with no visible
controls a user would recognize as "this is playing audio."

## Decision

### D1 — New column: `FileEntity.mediaType`, backed by a new `FileMediaType` enum

```typescript
export enum FileMediaType {
  image = 'image',
  audio = 'audio',
  video = 'video',
}
```

`backend/file/entity/file-media-type.enum.ts`, mirroring the existing
`FileVisibility` convention exactly (varchar-backed TS string enum, same file-header
shape). `FileEntity.mediaType` is `@Column({ type: 'varchar' })`, **not nullable**
(D3 covers how every existing row gets a real value).

### D2 — Server derives the value from the file extension; nothing is client-supplied

`FileService.uploadFile()` maps the stored path's extension to one of the three
classes itself, using the same three extension groups `TEMP_FILENAME_PATTERN`
(`backend/file/dto/create-uploadFile.dto.ts`) already enumerates. No new
`UploadFileDto` field, no change to `POST /upload/attach`'s response shape, no
change to `upload.controller.ts`/`upload.service.ts` at all — propagation is
entirely internal to the write path that already owns the insert.

Rejected alternative: have `POST /upload/attach` return `{ filename, mediaType }`
and have the client echo `mediaType` back in the `POST /file` body. Rejected
because the server can already derive the same fact with zero additional trust
surface — the extension is server-assigned and regex-validated
(`TEMP_FILENAME_PATTERN`) before this point, so asking the client to hand back a
value the server can compute itself adds a DTO field, two more files touched, and
one more place a client-supplied value has to be validated, for no capability
gained.

### D3 — Migration: nullable add → extension-derived backfill → `NOT NULL`

`migration:generate` only diffs entity shape against the live schema — it emits
`ADD COLUMN "mediaType" varchar` but has no way to know a `NOT NULL` constraint on
an already-populated table needs a backfill first. The migration lands as three
hand-reviewed statements in one file:

```sql
ALTER TABLE file_entity ADD COLUMN "mediaType" varchar;

UPDATE file_entity SET "mediaType" = CASE
  WHEN "filePath" ~* '\.(jpg|jpeg|png|webp)$' THEN 'image'
  WHEN "filePath" ~* '\.mp3$' THEN 'audio'
  ELSE 'video'
END;

ALTER TABLE file_entity ALTER COLUMN "mediaType" SET NOT NULL;
```

Every pre-existing `granted_` row already has a real extension in `filePath`
(the two-phase upload contract, ADR 0003, has never allowed an extensionless
`filePath`), so the `UPDATE` is a deterministic reclassification, not a guess —
it uses the same three extension groups as D2, just expressed as SQL instead of
TypeScript. Rejected alternative: a nullable column with no backfill. That would
leave every row uploaded before this change permanently `null`, which means the
very bug this ADR exists to fix (`FileDetailPage.tsx` always rendering
`<video>`) would persist forever for every file already in the database — a
result plainly at odds with the ADR's own purpose. Decided in favor of `NOT
NULL` + backfill specifically for that reason (Documentation Authoring Protocol
> 질문, confirmed with the developer before this ADR was written).

### D4 — `FileResponseDto` gains `mediaType`; `toResponse()` copies it verbatim

No derivation logic is duplicated at the DTO layer — the column already holds
the classified value, so `toResponse()` (`file.service.ts`) reads
`file.mediaType` the same way it reads `file.visibility` today.

### D5 — Frontend: branch the playback tag on `mediaType`, not on visibility

`FileDetailPage.tsx` and `PostDetailPage.tsx` both keep their existing
visibility-driven playback *source* logic unchanged (private → authenticated
blob fetch + `objectURL`; public/unlisted → direct `src`, ADR 0025/0026) — only
the **tag** each branch renders becomes conditional on `file.mediaType`:
`image` → `<img>`, `audio` → `<audio controls>`, `video` → `<video controls>`.
The two axes (visibility → how bytes are fetched; mediaType → which tag renders
them) are orthogonal and composed, not merged into one branch.

### D6 — Out of scope / not decided here

- **Deduplicating the extension→class mapping.** It now exists in three places
  with three different purposes — `TEMP_FILENAME_PATTERN`'s regex alternation
  (upload validation), `CONTENT_TYPE_BY_EXTENSION`
  (`file-content.controller.ts`, HTTP `Content-Type` header), and this ADR's new
  derivation in `file.service.ts` (persisted classification). This mirrors the
  existing, already-accepted pattern where `CONTENT_TYPE_BY_EXTENSION` is
  already a parallel, not shared, mapping alongside `TEMP_FILENAME_PATTERN` —
  consistent with Scope Discipline (no new shared abstraction unless asked).
  Accepted residual, not resolved here: a fourth accepted extension needs all
  three call sites updated together.
- **admin/'s file views.** `admin/` is a separate, out-of-repo-tooling frontend
  (CLAUDE.md > Project Overview) — not touched by this ADR even if it renders
  file content anywhere.
- **Re-deriving `mediaType` for rows whose `filePath` changes after creation**
  (`PATCH /file/:id { filePath }`). That path already restricts `filePath` to
  `granted_`-prefixed values with the same extension set — re-deriving
  `mediaType` on that write is not addressed here and is a residual gap if that
  path is ever used to swap a file's underlying type.

## Consequences

- Schema change: one new `NOT NULL` column plus a one-time data backfill,
  reviewed line-by-line before `migration:run` per Scope Discipline.
- No new client-trust surface: `mediaType` is entirely server-derived (D2), so
  it can never desync from the real uploaded file the way a client-echoed value
  could.
- `FileResponseDto` gains an additive field — no existing field renamed or
  removed, so this is not a breaking change under ADR 0011's error-code/response
  contract.
- `frontend/src/api/types.ts`'s `FileResponse` gains `mediaType`, kept in sync
  with the backend DTO in the same change (`frontend/CLAUDE.md` > API & Error
  Handling).
- No change to visibility, access control, or the `GET /file/:id/content` gate —
  orthogonal to ADR 0025/0026, which this ADR does not amend.
- `file.service.spec.ts`'s `mockFileEntity` gains a `mediaType` field to satisfy
  the now-required `FileEntity` shape; `uploadFile`'s insert-values assertion
  gains a `mediaType` expectation.

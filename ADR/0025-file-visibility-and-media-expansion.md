# ADR 0025: File Visibility, Access-Controlled Serving, and Media-Type Expansion

- Status: Accepted — implemented ([ADR 0026](0026-file-visibility-implementation.md) landed
  D1/D2/D3/D6, [ADR 0027](0027-media-type-expansion-implementation.md) landed D4/D5)
- Date: 2026-07-31 (design gate); implementation landed 2026-08-01
- 한국어: [0025-file-visibility-and-media-expansion.ko.md](0025-file-visibility-and-media-expansion.ko.md)

## Context

The four founding goals of this project were restated on 2026-07-31 and revealed
two gaps between the intent and the shipped code:

1. **File upload** — shipped.
2. **Any registered, signed-in user can upload / delete / share a link** — shipped
   (delete is creator-or-admin per [ADR 0013](0013-rbac-and-audit-log.md); a share
   "link" today is the public URL).
3. **A user can toggle their uploaded file between private and public** — **absent.**
   `FileEntity` has no visibility column, and every stored file is served publicly.
4. **Uploadable types are images, video, mp3, mp4 within 100 MB** — **partially
   absent.** The allowlist is video-only (`mp4`/`mov`/`webm`); images and audio are
   rejected, and the single multipart field is named `video`.

The hard part is goal 3. Today `ServeStaticModule` serves the whole `file/`
directory at `/file` ([ADR 0005](0005-local-disk-storage.md)); public URLs are
composed as `{BASE_URL}/{filePath}`. That model has **no per-file authorization** —
anyone who knows (or guesses) a `granted_` path reads the bytes. Making a file
private therefore cannot be a column flip alone; it requires changing how files are
served. This is the same concern [ROADMAP.md](../ROADMAP.md) Stage 4 deferred as
"VOD playback access control", now generalized from video to all media and pulled
forward as its own dedicated task.

A second constraint changed since Stage F: the API surface was frozen with **zero
consumers** ([ADR 0010](0010-frontend-split-and-api-surface-freeze.md)), but the
`frontend/` subfolder now exists and consumes this API. The upload-field change
below is therefore a **breaking change against a live consumer**, unlike the Stage F
renames — its frontend adoption is tracked as a cross-repo open decision.

This ADR is the plain-text design gate that Scope Discipline requires before any
migration or code — it decides *what and why*, not line-by-line *how*. Implementation
lands as its own follow-up task with a reviewed migration.

## Decision

### D1 — Three visibility states, private by default

`FileEntity` gains a `visibility` column: an enum `'public' | 'private' | 'unlisted'`,
**default `'private'`** (secure by default). Meaning:

- **public** — anyone, no authentication.
- **private** — only the file's creator (or admin+, matching `canManage`).
- **unlisted** — anyone holding the file's current share token, **including
  unauthenticated / unregistered visitors**. This is the "link share" of goal 2.

Default private means a fresh upload is not reachable until the owner opts into
`public` or `unlisted`. Visibility is toggled through the existing owner-guarded write
path (`PATCH /file/:id`), not a new authorization axis.

### D2 — All upload bytes are served through an access-controlled endpoint

A new `GET /file/:id/content` streams the stored file **after** an access check keyed
on `visibility`:

- public → served to anyone;
- private → requires a JWT whose subject is the creator (or admin+);
- unlisted → requires a matching share token, `GET /file/:id/content?share=<token>`,
  with **no login required**.

**`ServeStaticModule` must stop exposing `file/upload`.** Keeping it would defeat D1:
a private file's bytes still sit at a `granted_` path that static serving hands out by
URL. Granted-file reads therefore go through the endpoint, where `visibility` is
enforced; "public" simply means the endpoint skips the check.

**Open sub-decision — the author's call at implementation, not settled here.** Whether
a genuinely-public file is *additionally* served from a separate truly-public static
directory (for static-serving performance) or whether **all** granted reads route through
the endpoint is deliberately left open for the implementation task to decide, under Scope
Discipline and the Clarification Protocol (a new serving mechanism is a clarify-before-build
change). The recommendation below is a starting point to argue from, **not a made
decision**: routing everything through the single endpoint is the simpler, single-correct-
path option and avoids keeping two copies/locations of a public file in sync — but the
author decides when the task lands. What *is* decided here is only the contract-level
invariant: `file/upload` is no longer statically exposed, and access is enforced by the
endpoint.

This is a **partial revision of [ADR 0005](0005-local-disk-storage.md)**: local disk
storage and the `temp_`/`granted_` two-phase promotion
([ADR 0003](0003-two-phase-upload-contract.md)) stay; only the *serving* mechanism for
`file/upload` changes.

### D3 — Share token: random, rotatable, with optional TTL

`FileEntity` gains a nullable `shareToken` (a server-generated random opaque string,
never a guessable id) and a nullable `shareExpiresAt` timestamp.

- The token is generated when a file is set to `unlisted`; a `public`/`private` file
  has none.
- **Rotation is the baseline revocation mechanism**: regenerating the token
  invalidates every previously shared link immediately. This is what a signed URL
  cannot do and is required because goal 2's shared links leak by nature.
- **TTL is optional and defaults to "no expiry"** (`shareExpiresAt` null → permanent
  link, which is what a recipient finds convenient). An owner who wants a temporary
  share sets an expiry; the endpoint refuses an expired token. TTL is a hygiene/
  convenience layer, **not** a leak defense — only rotation stops an already-leaked
  link before its expiry.

### D4 — Media-type allowlist expanded to images, audio, and video

The upload allowlist becomes, all still ≤ 100 MB (the [ADR 0005](0005-local-disk-storage.md)
ceiling is unchanged):

| Class | Extensions | Mimetypes |
|---|---|---|
| Image | jpg/jpeg, png, webp | image/jpeg, image/png, image/webp |
| Audio | mp3 | audio/mpeg |
| Video | mp4, mov, webm | video/mp4, video/quicktime, video/webm |

Client-supplied mimetype and extension stay an allowlist against accidental/blatant
misuse, not a content guarantee — the existing stance (Never Do Group 3).

### D5 — Type-specific multipart fields replace the single `video` field

`POST /upload/attach` accepts one of three named fields — `image`, `audio`, `video`
— each with its own class allowlist, instead of the single `video` field accepting a
union. The field name self-documents the expected class and keeps each allowlist
local to its field. This **revises the frozen surface**
([ADR 0010](0010-frontend-split-and-api-surface-freeze.md)) and the
[ADR 0003](0003-two-phase-upload-contract.md) upload contract; because a live frontend
consumer now exists, its adoption is a tracked cross-repo task (see Consequences). The
`temp_{uuid}_{ts}.{ext}` naming and the one-shot claim token
([ADR 0019](0019-upload-claim-idempotency.md)) are unaffected — they key off the
extension, not the field name.

### D6 — New error codes (to be finalized with their consumers)

- `FILE_SHARE_INVALID` (403) — an `unlisted` file requested with a missing, wrong, or
  expired share token.
- A private file requested by a non-owner reuses the existing 403 `FORBIDDEN_NOT_OWNER`
  vs. a 404 `FILE_NOT_FOUND` to avoid confirming the file exists — an existence-
  disclosure trade decided at implementation. Type rejection keeps
  `UPLOAD_INVALID_TYPE`. Per the catalog convention, codes are added with the code
  that throws them, not ahead of it ([ADR 0011](0011-error-code-contract.md)).

## Alternatives rejected

- **Signed, expiring URLs for private/unlisted (serving option B)** — the share URL
  carries its own signed expiry and `ServeStaticModule` stays behind a
  signature-checking middleware. Rejected: a signed link **cannot be individually
  revoked** before it expires, which is exactly the leak-response goal 2 implies. D3's
  stored token gives rotation *and* optional TTL — a superset.
- **Everything through the app, no static serving at all (serving option C), as the
  contract** — chosen *in effect* for `file/upload` (D2), but rejected as a blanket rule:
  whether a genuinely public file is additionally served from a static directory is left
  open for measurement rather than banned up front.
- **Single generic field rename (`video` → `file` or `media`)** — one field accepting the
  whole union. Simpler surface, but one allowlist must branch on class internally and the
  field name stops telling the client what it holds. D5's per-type fields were chosen for
  the self-documenting, per-field allowlist; the rename remains the fallback if the three
  fields prove unergonomic for the frontend.
- **A separate `POST /upload/attach/image` etc. per class** — most explicit, but triples
  the route surface for what one endpoint with three fields expresses, and multiplies the
  Swagger/error surface for no gain.
- **Visibility as a boolean `isPublic`** — cannot express the third "unlisted" state goal
  2 needs; a two-value flag would force link-sharing to mean "fully public", losing the
  "only those with the link" property.

## Consequences

- **Schema change (reviewed migration at implementation)**: `FileEntity` gains
  `visibility` (enum, default `private`), `shareToken` (nullable), `shareExpiresAt`
  (nullable). Registered in all three entity locations per CLAUDE.md; `migration:generate`
  output reviewed line by line, spurious constraint-renames stripped
  ([ADR 0006](0006-schema-policy-and-migration-adoption.md)).
- **`ServeStaticModule` no longer serves `file/upload`** (D2). The residual
  implementation sub-decision — serve public files from a separate truly-public directory
  for static-serving performance, or route *all* granted reads through the endpoint and let
  "public" be an auth-skipped path — is **left open for the author to decide at the
  implementation task** (see D2), not settled here; the recommendation recorded there is a
  starting point, not a made decision. `file/temp` static exposure is a separate matter the
  orphan-cleanup sweep ([ADR 0018](0018-orphan-temp-file-cleanup.md)) already governs.
- **`FileResponseDto` gains `visibility` and, for the owner, the share URL**; the public
  `fileUrl` becomes the content-endpoint URL rather than a raw static path. Response
  shaping stays in `FileService.toResponse` (Boundary Validation & Response Shaping).
- **Breaking change against a live consumer.** Unlike the Stage F freeze (zero consumers),
  the `frontend/` subfolder consumes this API. The `video`→`image`/`audio`/`video` field
  change, the new content endpoint, and the visibility fields all require frontend uptake:
  `frontend/docs/API-CONTRACT.md` and the upload/list/playback views must adopt them. Per
  [CLAUDE.md](../CLAUDE.md) > Project Overview, that work is a **frontend-scoped task**;
  the backend change stops at the repo boundary. Tracked in ROADMAP > Unscheduled.
- **Range requests (video/audio seeking)** were free under `ServeStaticModule` (Express
  handles them); the content endpoint must handle `Range` explicitly (`StreamableFile` +
  partial responses) so playback seeking keeps working.
- **Generalizes and supersedes the Stage 4 "VOD playback access control" row** — the
  access-controlled serving here covers all media, not just video, so the roadmap replaces
  that row with this task and may sequence it ahead of deployment (access control is
  independent of the deploy target).
- **Ownership stays `canManage`** (creator or admin+) — no new authorization axis. Setting
  visibility and rotating a share token are owner writes on a file the caller already
  controls.
- **Test coverage at implementation**: visibility access matrix (public/private/unlisted ×
  owner/other/anonymous), share-token rotation invalidating an old link, TTL expiry, and
  per-field type rejection — unit (`file.service.spec.ts`) plus e2e over real HTTP+DB.

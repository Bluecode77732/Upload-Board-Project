# Changelog

> 한국어 버전: [CHANGELOG.ko.md](CHANGELOG.ko.md)

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). No version
tags exist yet, so history is grouped by commit date under the initial `0.0.1`
development line (package.json version).

> **Reconstruction note**: entries up to 2026-07-22 were reconstructed after the fact
> from git history (commit hashes cited). Where a commit message was uninformative,
> the entry describes what the diff actually shows.

## [Unreleased]

### Added
- **File visibility + media-type expansion — design gate, no code yet**
  ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.md)) — restating the project's
  four founding goals surfaced two gaps between intent and shipped code: every stored file is
  served publicly with no private/unlisted option, and the upload allowlist is video-only. The
  decision (a plain-text gate, per Scope Discipline, ahead of any migration) adds a 3-state
  `FileEntity.visibility` (`public`/`private`/`unlisted`, **default `private`**), an
  access-controlled `GET /file/:id/content` endpoint that enforces access by state — so
  `ServeStaticModule` **stops exposing `file/upload`** (a private file's bytes must not stay
  reachable by their `granted_` path), an `unlisted` share via a **rotatable** `shareToken`
  (rotation is the leak-response mechanism a signed URL cannot give) plus an **optional** TTL
  `shareExpiresAt` (default: no expiry), and a media-type expansion to images (jpg/png/webp) +
  audio (mp3) + video (mp4/mov/webm) across **type-specific upload fields** (`image`/`audio`/
  `video`) replacing the single `video` field. It **partially revises**
  [ADR 0005](ADR/0005-local-disk-storage.md) (serving) and
  [ADR 0003](ADR/0003-two-phase-upload-contract.md)/[ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)
  (upload field — now a **breaking change against the live `frontend/` consumer**, unlike the
  zero-consumer Stage F freeze). It **generalizes and replaces the ROADMAP Stage 4 "VOD playback
  access control" row** and, being independent of the deploy target, may be sequenced ahead of
  deployment. No schema change, migration, or route lands in this entry — the reviewed migration
  and the frontend adoption are their own follow-up tasks (the latter tracked in
  [ROADMAP.md](ROADMAP.md) > Unscheduled).
- **File visibility + access-controlled content endpoint — implemented**
  ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.md) D1/D2/D3/D6 +
  [ADR 0026](ADR/0026-file-visibility-implementation.md)) — the design gate above lands for
  everything except media-type expansion (D4/D5, still its own pending task). `FileEntity`
  gains `visibility` (`public`/`private`/`unlisted`, default `private`), `shareToken`, and
  `shareExpiresAt` (migration `1785571437643-AddFileVisibility`, reviewed line-by-line against
  the raw `migration:generate` output). `GET /file/:id/content` is the sole path that serves
  granted bytes — Range-aware (video/audio seeking), guarded by a new `OptionalJwtAuthGuard` so
  public/unlisted access works with no bearer token at all — resolving D2's open sub-decision in
  favor of a single endpoint over a parallel public static directory. `ServeStaticModule` now
  roots at `file/temp` only; `file/upload` is no longer statically exposed.
  `GET /file`/`GET /file/:id` also filter `private`/`unlisted` rows from non-owner/non-admin
  requesters (a gap ADR 0025's text never addressed, settled as ADR 0026 D7) — content and
  metadata deliberately disclose non-access differently (ADR 0026 D8): metadata answers 404
  `FILE_NOT_FOUND` (hides existence), content answers 403 `FORBIDDEN_NOT_OWNER` or 403
  `FILE_SHARE_INVALID` (confirms existence, refuses bytes). Visibility toggling and share-token
  rotation reuse the existing `PATCH /file/:id` write path rather than a new endpoint.
  `FileResponseDto.fileUrl` now points at the content endpoint instead of a static path; a new
  `visibility` field is always present, and `shareUrl` only for a manager of an unlisted file.
  New error code `FILE_SHARE_INVALID` (403). Test coverage: the full visibility access matrix
  (public/private/unlisted × owner/stranger/anonymous/admin), token rotation invalidating the
  previous link, TTL expiry, and Range requests — both unit (`file.service.spec.ts`) and e2e
  over real HTTP+DB (`test/app.e2e-spec.ts`).
- **Media-type expansion — type-specific upload fields implemented**
  ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.md) D4/D5 +
  [ADR 0027](ADR/0027-media-type-expansion-implementation.md)) — the design gate's other
  half. `POST /upload/attach` now accepts one of three multipart fields — `image`
  (jpg/jpeg/png/webp), `audio` (mp3), `video` (mp4/mov/webm, unchanged) — each with its own
  class allowlist, via `FileFieldsInterceptor` and a shared `fileFilter` keyed off
  `file.fieldname`. Attaching zero fields still 400s `UPLOAD_FILE_REQUIRED`; attaching more
  than one is a new 400 `UPLOAD_MULTIPLE_FIELDS`. `TEMP_FILENAME_PATTERN`
  (`create-uploadFile.dto.ts`) and `CONTENT_TYPE_BY_EXTENSION`
  (`file-content.controller.ts`) — both extension-keyed, not field-keyed — widened in step,
  so `POST /file` promotion and `GET /file/:id/content` serving stay correct for the new
  classes. No schema change. Breaking change against the live `frontend/` consumer, exactly
  as ADR 0025 D5 already flagged — frontend adoption stays its own separate task. Test
  coverage: an image and an audio round trip (attach → promote → content `Content-Type`),
  a wrong-type-for-field rejection, and a two-fields-at-once rejection, added to
  `test/app.e2e-spec.ts`; existing `video`-field e2e cases pass unmodified.
- **Frontend adoption of file visibility + media-type expansion**
  ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.md)/
  [0026](ADR/0026-file-visibility-implementation.md)/
  [0027](ADR/0027-media-type-expansion-implementation.md)) — closes the breaking-change gap
  the two backend entries above left open ([ROADMAP.md](ROADMAP.md) > Unscheduled). The file
  board (`frontend/src/features/files/FileBoard.tsx`) gains `GET /file`'s full ADR 0021 query
  surface (debounced search, sort field/order, creator-ID filter, pagination) plus a
  `VisibilityBadge` per row. `FileDetailPage` (`/view/:id`) reads `fileUrl` as the
  access-controlled content endpoint: `public`/`unlisted` files stream via a direct
  `<video src>` (keeping Range-based seeking), `private` files fetch authenticated as a Blob
  and play from an objectURL revoked on unmount (a plain `<video src>` can't carry a Bearer
  header). A "Manage" section, shown only to the creator/admin (a client-side hint only —
  every write is re-checked server-side), toggles visibility and rotates the unlisted share
  token, both via the existing `PATCH /file/:id` (no new endpoint, per ADR 0025 D3), plus a
  confirmed `DELETE /file/:id` that surfaces `FILE_IN_USE` if a post references the file.
  `UploadForm` replaces its single `video` field with radio-selected `image`/`audio`/`video`
  fields mirroring the backend's per-field allowlist, and gains upload-progress reporting via
  a new `api.postFormWithProgress` (`XMLHttpRequest`-based, since `fetch` exposes no
  upload-progress event — the one piece here not itself required by ADR 0025/0026/0027).
  `frontend/docs/API-CONTRACT.md` already documented the target contract. No backend change.
- **Board comment module — the board domain is complete**
  ([ADR 0023](ADR/0023-board-domain-schema.md) > Implementation notes) — the second half of
  the schema gate, and with it **Stage 3**. `CommentModule` ships the ADR's four routes behind
  `JwtAuthGuard`, split across **two controllers** because they span two prefixes: a thread
  hangs off its post (`GET`/`POST /post/:postId/comment`) while an existing comment is
  addressed by its own id (`PATCH`/`DELETE /comment/:id`). The new `comment_entity` carries
  `body` (`text`, bounded ≤1,000 at the DTO), a `creatorId` FK, and a `postId` FK with **the
  schema's only `ON DELETE CASCADE`** — argued in ADR 0023 D3 rather than assumed, because a
  comment has no URL, no file, and no existence outside its post, so nothing must be read
  before the rows go. `IDX_comment_entity_postId_createdAt` serves the one query shape this
  table has. The migration was reviewed line by line as
  [ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md) requires — `generate` emitted
  six spurious constraint-rename statements, which were stripped in favor of readable names.
  **The thread reads oldest-first** (`createdAt ASC` with an `id` tiebreaker), the opposite of
  the newest-first file and post listings, and the order is fixed rather than parameterized.
  Ownership reuses `canManage` (author **or** admin+) with **no third axis**: the author of a
  post gains no power over comments on it, since that would need the
  `comment.post.creator` reach-through this project bans. `COMMENT_NOT_FOUND` and the
  `COMMENT_DELETE` audit action arrived with their consumers. Two decisions were kept rather
  than softened — a repeated `POST` creates a second comment (nothing on the row is unique, so
  there is no natural idempotency key, exactly as for a post with no `fileId`), and the
  `USER_DELETE` audit detail gains **no** `comments=N` (the cascaded half is uncountable, so a
  partial count would read as a total).
- **Frontend Playwright E2E specs — auth, upload, board** — `frontend/e2e/` gains three specs
  beyond the existing harness/smoke check (`playwright.config.ts`, `smoke.spec.ts`):
  `auth.spec.ts` (register→signIn→signOut through LoginPage, plus the
  `AUTH_EMAIL_TAKEN`/`AUTH_INVALID_CREDENTIALS` error-code branches), `upload.spec.ts` (the
  two-phase `POST /upload/attach` → `POST /file` flow through a real file input, plus
  `FILE_TITLE_TAKEN` on a duplicate title), and `board.spec.ts` (FileBoard's
  search/sort/creator-filter/pagination against files it uploads itself, plus the default
  `private` visibility badge). Every spec registers a unique account (and unique titles) per
  run, since the shared dev DB behind `:5173`'s Vite proxy is never truncated (unlike the
  backend's dedicated e2e DB); assertions branch on the app's own code-mapped error strings
  (`messageForError`), never the backend's raw `message`, matching `docs/API-CONTRACT.md`'s
  "branch on `code`" rule. A real mp4 (copied from `assets/files/sample.mp4`) lives at
  `frontend/e2e/fixtures/sample.mp4`. Two Playwright quirks surfaced writing these and are now
  recorded in `frontend/CLAUDE.md` so they aren't rediscovered: re-setting an
  `<input type="file">` to an identical path back-to-back doesn't reliably fire a `change`
  event (fixed by clearing the input first), and `getByLabel`/`getByRole`'s default
  substring+case-insensitive name matching collided with this app's own markup (a `<select>`
  nested inside a `<label>` folds its option text into the label's accessible name; a
  generated test email containing a common word matched an unrelated button) — fixed with
  `{ exact: true }` on the affected queries. No backend or app-code change.
- **Frontend Playwright E2E specs — file detail page** — `frontend/e2e/detail.spec.ts` exercises
  `/view/:id` (`FileDetailPage`) end to end: a private file's authenticated blob playback, and
  that its objectURL is revoked (`URL.revokeObjectURL`, spied via `page.addInitScript`) on
  navigating away; toggling to `public`/`unlisted` and confirming the content endpoint answers
  with no bearer token or cookies at all, using Playwright's bare `request` fixture, which shares
  neither the page's cookies nor its in-memory access token; rotating an unlisted share token and
  confirming the old one now 403s `FILE_SHARE_INVALID` while the new one still plays; a
  stranger's `/view/:id` for another user's private file answering 404 `FILE_NOT_FOUND`
  (existence hidden, ADR 0026 D8) with no Manage section rendered; and `DELETE /file/:id`
  refusing with `FILE_IN_USE` while a post references the file (attached directly through the
  backend API as test setup, since the frontend has no post UI yet), then succeeding once the
  blocking post is removed, with the file gone from the board. No backend change.

### Fixed
- **`api.delete`'s success path threw on `DELETE /file/:id`'s plain-text body** —
  `frontend/src/api/client.ts`'s shared `request()` unconditionally called `response.json()` on
  any non-204 2xx response, but `DELETE /file/:id` answers `200 text/html` with a plain string
  (`File ${id} deleted.`), so the parse threw a `SyntaxError`; `FileDetailPage.handleDelete`'s
  catch treated that as a generic failure ("Network error. Is the backend running?"), so deleting
  a file never navigated away even though the backend had already deleted it. Found writing
  `detail.spec.ts`'s delete-flow assertion. `request()` now only parses JSON when the response's
  `Content-Type` says so, otherwise resolving `undefined` (mirroring the existing 204 case); no
  caller of `api.delete` uses the resolved value, so this is a pure bug fix with no behavior
  change for any JSON-returning endpoint. No backend change — the backend's plain-text 200 for a
  delete is unaffected.

### Changed
- **The account cascade now deletes comments first, then posts, then files**
  ([ADR 0023](ADR/0023-board-domain-schema.md) D5) — `UserService.remove` deletes the
  account's comments *anywhere* inside its existing `dataSource.transaction()`, keyed by
  `creatorId`, before the posts. The order is load-bearing: comments the account wrote on
  **other people's** posts are unreachable through the post FK cascade, which only fires when
  the owning post is deleted. Comments left on the account's own posts still go with them
  through that cascade. No confirmation flag was added — `deleteFiles` keeps guarding media
  bytes only. `PostService.assertPostExists` was added so `CommentService` can refuse a
  comment on a missing post with 404 `POST_NOT_FOUND` without ever querying `post_entity`
  itself (Tell Don't Ask, the same shape as `FileService.assertAttachableBy`).

### Fixed
- **The account cascade answers 409 `USER_FILES_IN_USE` instead of an FK-violation 500**
  ([ADR 0024](ADR/0024-account-cascade-fk-refusal.md)) — closes the known issue the post
  module recorded a day earlier, and the gate the comment module waited on.
  `PATCH /file/:id { userId }` can reassign a file's owner *after*
  `FileService.assertAttachableBy` enforced ADR 0023 D1's same-creator rule at creation, so a
  post can end up referencing a stranger's file; `DELETE /user/:id?deleteFiles=true` then raised
  `23503` inside its transaction and surfaced as exactly the opaque 500
  [ADR 0020](ADR/0020-account-deletion-cascade.md) set out to remove.
  `FileService.deleteFilesOfCreator` now translates that `23503` the same way its sibling
  `deleteFile` already translated `FILE_IN_USE` — both file-row delete paths answer a reference
  identically, in the class that owns file rows. **No pre-check query**, for the two reasons
  [ADR 0023](ADR/0023-board-domain-schema.md) D4 established: `FileService` reading
  `post_entity` is a module cycle, and a post created between check and delete would still hit
  the constraint. The other two candidate fixes were rejected on the record — widening the
  cascade would destroy third-party posts *and* rewrite the delete order the comment task
  extends, and a composite FK (`UNIQUE (id, creatorId)` on `file_entity`, referenced by
  `post_entity`) is documented in that ADR as the shape to adopt only if the property is ever
  needed as a *guarantee*. One new error code, `USER_FILES_IN_USE` (409), named symmetrically
  with `USER_HAS_FILES` on the same route. No schema change, no migration. **Two things
  deliberately unchanged**: the post↔file rule is now a creation-time rule rather than an
  invariant, and `PostService.resolveAttachment`'s author-identity check stays reachable, so
  it must not be simplified away. Writing this ADR also surfaced a prior question it does
  **not** answer: **no decision anywhere argues why `PATCH /file/:id { userId }` should exist**
  — it transfers a file outright, the recipient never consents, and ADR 0007 mentions the field
  only to say its guard is creator-only. That is now tracked in ROADMAP > Unscheduled, with the
  coupling recorded: dropping the field would make this fix's `23503` branch an unreachable
  guard, so it would supersede ADR 0024 rather than extend it.

### Changed
- **ROADMAP execution order for the remaining work fixed** (2026-07-31) — the staged
  plan groups tasks by dependency, but several ready items span stages, so the actual
  build sequence is now pinned in [ROADMAP.md](ROADMAP.md) §6: #1 board post/comment
  modules → #2 `GET /user` pagination (pulled forward from Stage 5 as an independent
  Never Do Group 2 debt, owed regardless of the console) → #3 Stage 5 admin surface →
  #4 Stage 4 deployment (last). This resolves Stage 5's documented "numbering is not
  dependency order" floating position in favor of Stage 5 **before** Stage 4, and pulls
  the pagination debt ahead of both. Documentation only — no code or plan-scope change.

### Added
- **Board post module — the board domain's first module**
  ([ADR 0023](ADR/0023-board-domain-schema.md) > Implementation notes) — implements the first
  half of the schema gate settled a day earlier. `PostModule` ships five routes behind
  `JwtAuthGuard` (`GET /post`, `GET /post/:id`, `POST /post`, `PATCH /post/:id`,
  `DELETE /post/:id`) over a new `post_entity`: `title` (deliberately **not** unique, unlike
  `FileEntity.title` — a board where a title can be used once globally is a defect), `body`,
  a `creatorId` FK, and a **unique, nullable** `fileId` FK. **Split from the comment module**
  because comment depends on post and not the reverse, so the migration landed in two parts
  rather than the one the ADR describes; `comment_entity` is the next task. The migration was
  reviewed line by line as [ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md)
  requires — `generate` emitted four spurious statements dropping and re-adding
  `FK_file_entity_creator` and `IDX_audit_log_entity_action_createdAt` purely to rename them
  to TypeORM hashes, which were stripped in favor of the baseline's readable naming.
  **The unique `fileId` is the endpoint's idempotency key**, which `title` cannot be: an
  identical resubmission replays the existing post with 200, the same `fileId` with different
  author-written text is 409 `POST_FILE_TAKEN`, and a concurrent double-submit that loses the
  unique constraint re-resolves through the same path instead of becoming a 500. That is
  [ADR 0019](ADR/0019-upload-claim-idempotency.md)'s mechanism with one deliberate difference
  — ADR 0019 replays unconditionally, but a post carries text a file promotion does not, so
  replaying a *different* title/body would answer a genuinely new submission with somebody's
  earlier post. Ownership reuses `canManage` unchanged (author **or** admin+,
  [ADR 0013](ADR/0013-rbac-and-audit-log.md)), and the listing reuses the
  [ADR 0021](ADR/0021-list-query-search-filter-sort.md) read layer — escaped ILIKE, the total
  `Record` sort whitelist, the `id` tiebreaker — rather than restating it (the escaping helper
  moved to `backend/common/escape-like-pattern.ts` so both endpoints share one copy).
  Attaching a file is **identity-only, not `canManage`**: `FileService.assertAttachableBy`
  refuses even an admin attaching another user's file, because "a post references only its own
  author's file" is exactly what keeps the account cascade FK-safe. Three new error codes
  (`POST_NOT_FOUND`, `POST_FILE_TAKEN`, `FILE_IN_USE`); `COMMENT_NOT_FOUND` was deliberately
  **not** added ahead of its consumer.

### Changed
- **`DELETE /file/:id` on a file a post references is now 409 `FILE_IN_USE`**
  ([ADR 0023](ADR/0023-board-domain-schema.md) D4) — the new FK makes the delete raise
  `23503`, which without translation is the same opaque 500 that
  [ADR 0020](ADR/0020-account-deletion-cascade.md) removed from `DELETE /user/:id`. **No
  pre-check query was added**, on two independent grounds: it would make `FileService` read
  `post_entity` while `PostService` already asks `FileService` about ownership (a module cycle
  needing `forwardRef`, with no precedent here), and a post created between the check and the
  delete would still hit the constraint — the 500 would become rarer, not impossible. The
  database is the authority. `ON DELETE SET NULL` was rejected outright: it makes the delete
  always succeed by silently stripping the video out of a published post. Deleting a post
  leaves its file alone — a post *references* a file, it never owns it.
- **The account cascade now takes posts, unconfirmed** ([ADR 0023](ADR/0023-board-domain-schema.md)
  D5) — `UserService.remove` deletes the account's posts inside its existing
  `dataSource.transaction()`, **before** the file rows (`FK_post_entity_file` and
  `FK_post_entity_creator` are both `ON DELETE NO ACTION`), keyed by `creatorId` rather than an
  id list read moments earlier. `?deleteFiles=true` keeps its exact meaning: it confirms the
  destruction of **file rows and stored bytes**, and 409 `USER_HAS_FILES` still fires only for
  files. Widening it was rejected — the parameter name and error code would then describe
  something narrower than what they gate, and a second flag would add a query parameter to a
  frozen route ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)). The honest
  cost is recorded rather than papered over: deleting an account destroys its posts with no
  confirmation step. The audit detail gains the count (`files=N posts=N`), and `POST_DELETE`
  joins `AUDIT_ACTIONS`.
- **`FileService.toResponse` is public** — ADR 0023 D1 requires the `BASE_URL` composition to
  stay in `FileService` and be reused, so `PostService` delegates the attached file's URL to it
  rather than recomposing one. `PostService` never reads `file.creator` (Law of Demeter).

### Known issue
> Resolved 2026-07-31 by [ADR 0024](ADR/0024-account-cascade-fk-refusal.md) — see **Fixed**
> above. The `23503` is now a typed 409; the `resolveAttachment` guard stays as described.

- **File ownership reassignment can break the post↔file same-creator invariant** — ADR 0023 D1
  argues a post can only reference its own author's file, and that is what makes the account
  cascade FK-safe. It holds at creation, but `PATCH /file/:id { userId }` reassigns ownership
  afterwards. Two consequences, both left deliberately unchanged because resolving them is a
  decision rather than an implementation detail: `resolveAttachment` carries an author-identity
  check so a file's new owner is never handed the previous owner's post as a "retry" (reachable
  precisely because of reassignment, hence not an unreachable guard); and
  `DELETE /user/:id?deleteFiles=true` can still raise `23503` in the narrow case where the
  account's files were reassigned from a user whose post still references one. Tracked in
  ROADMAP > Unscheduled with the three candidate fixes, each needing its own ADR.

### Changed
- **ROADMAP gains Stage 5 — operational surface (admin console)**
  ([ADR 0022](ADR/0022-admin-console-import-from-chat-project.md)) — the second amendment to the
  plan the 11-axis review fixed on 2026-07-23 (the first was Stage F, ADR 0010). It closes a gap
  rather than adding scope: ADR 0010 decided *where* admin lives back on 2026-07-23, but **no
  stage ever owned building it**, so the work sat outside the staged list while every other
  decided item had a row — an admin console is neither board domain (Stage 3) nor infrastructure
  (Stage 4). Five task rows: the blocking backend decision of **how a client learns its own role**
  (the access token is `{ sub, type }` with no `role` claim, so no admin route can be gated
  today — needs an ADR amending [ADR 0002](ADR/0002-dual-secret-token-pair.md)), adapting the
  imported `admin/` console, **`GET /user` pagination** (owed regardless of the console —
  `findAll()` binds no `@Query()` and returns every user, a standing violation of this project's
  own Never Do Group 2 pagination rule), resolving the duplicate admin surface, and deciding
  whether moderation actions (`ban`/`unban`/`force-logout`) should exist at all — default "no",
  and building any of them would be new backend surface with its own ADR, not a side effect of
  adapting a UI. **Stage 5's number is not dependency order** — the one documented exception in
  that section: it depends only on Stage 0 (RBAC, complete) plus its own first row, not on
  Stage 4, and there is a stated argument for pulling it *ahead* of Stage 4 since a deployed
  system whose privilege hierarchy is operable only through Swagger is hard to run.

### Added
- **Imported admin console at `admin/`, documented as a modification base**
  ([ADR 0022](ADR/0022-admin-console-import-from-chat-project.md)) — imported wholesale from the
  author's other project, the **Chat Project** (NestJS + GraphQL + Redis + Socket.IO), as the
  top-level `admin/` folder and committed **unmodified**. **Two stated purposes, both
  load-bearing.** *(1) User privilege-hierarchy management* — the requirement.
  [ADR 0013](ADR/0013-rbac-and-audit-log.md) shipped RBAC's mechanism (three tiers with a
  `ROLE_RANK` ordering, superadmin-only `PATCH /user/:id/role`, `ROLE_CHANGE` audit rows) but no
  way to operate it: the first superadmin comes from the `SUPERADMIN_EMAIL` boot seed, every
  promotion or demotion after that is a raw request or a Swagger form, and the two invariants
  protecting the hierarchy — the last-superadmin refusal (400 `AUTH_LAST_SUPERADMIN`) and the
  session termination every role change causes (`refreshTokenHash` nulled) — are invisible to
  whoever triggers them. ADR 0013's own closing line deferred this surface; ADR 0022 answers it.
  *(2) Token economy* — the method. The Chat Project's console was built against the **same**
  three-tier hierarchy (ROADMAP records this project's RBAC design as "Chat-project style"), so
  its users page already carries the role column, the assignment control, the per-user detail
  panel, and the per-user audit slice, on top of domain-independent scaffolding (router, route
  guard, Zustand auth store, single-flight silent-refresh guard, axios interceptors,
  Playwright/Vitest harnesses). Importing that costs a fraction of the tokens regenerating it
  prompt-by-prompt would — tokens then go to the API delta instead. **The role-management slice
  is where adaptation starts**: `PATCH /user/:id/role`, `GET /user`, `GET /user/:id`,
  `DELETE /user/:id`, `GET /audit-log`, and `POST /auth/signin` are all routes this API actually
  has, and the imported rank values `0/1/2` match `ROLE_RANK` exactly — the hierarchy *model*
  transfers unchanged, only its *encoding* (numeric vs. the `UserRole` string enum) and its
  *guard rules* (the console shows the role control to any admin, but the endpoint is
  superadmin-only) do not. **This folder does not work against this backend, and is not meant to
  yet**: every file in it still targets the Chat Project's API. `admin/README.md`(.ko) says so
  at the folder itself, and ADR 0022 carries the verified modification backlog (Apollo
  `/graphql` layer to delete, `refreshaccess`/`signOut` route names, numeric-vs-string roles, a
  `role` claim the access token does not carry, chat-domain pages, ban/force-logout endpoints
  that do not exist here, `page`/`take` vs `take`/`skip`, `/audit-log/export`, the
  [ADR 0020](ADR/0020-account-deletion-cascade.md) deletion confirmation, `ErrorBody` code
  branching, and a `vercel.json` CSP pinned to the chat project's Railway host — left untouched
  on purpose so the adaptation task can diff against the original). Adapting it is **its own
  dedicated task**, and several backlog rows are backend questions needing their own decisions.
  **Nothing is wired up**: `admin/` sits outside the lint glob
  (`{backend,apps,libs,test}/**/*.ts`), Jest `roots` (`["backend"]`),
  `tsconfig.build.json`, `docker-compose.yml`, and CI, and carries its own
  `package.json`/`node_modules` — not a pnpm workspace, the same precedent `frontend/` set. No
  backend behavior, endpoint, schema, env var, or guard changed. No secrets are tracked
  (`admin/.gitignore` already covers `.env`, `.env.local`, `e2e/.env`, `node_modules`, `dist`;
  verified with `git check-ignore`).
- List search / filter / sort on `GET /file` (Stage 3 — domain expansion;
  [ADR 0021](ADR/0021-list-query-search-filter-sort.md)): four optional query parameters,
  all declared on `GetFilesDto`, with the `[files, totalCount]` response shape unchanged.
  **`search`** matches the title case-insensitively as a substring (`ILIKE '%term%'`) with
  LIKE metacharacters (`\`, `%`, `_`) escaped and `ESCAPE '\'` stated, so a `%` in the term
  matches literally instead of silently widening the result; a whitespace-only term is
  treated as absent, and the term is capped at 100 characters. **`creatorId`** filters by
  author through the creator join that already exists (no extra query). **`sortBy`**
  (`createdAt` | `title` | `id`) and **`order`** (`DESC` | `ASC`) are resolved through a
  total `Record<FileSortField, string>` in `FileService`, so a client string never reaches
  the query as a column name and adding a sort key without a column mapping is a compile
  error; `filePath` is deliberately not offered. Full-text search, `pg_trgm`, a compound
  `sort=field:dir` string, a `creatorEmail` filter, and keyset pagination were all
  considered and rejected in the ADR.
- Deletion policy (Stage 2 — mechanism hardening;
  [ADR 0020](ADR/0020-account-deletion-cascade.md)): **soft delete is not adopted** —
  deletion stays hard, and the reasons are recorded in the ADR. `DELETE /user/:id` now
  takes an optional `deleteFiles` confirmation: with `deleteFiles=true` the account is
  deleted **together with every file it owns** (file rows → account row inside one
  `dataSource.transaction`, then the stored files are unlinked **after** the commit, since
  `unlink` cannot be rolled back). Without it, an account that still owns files is refused
  with the new **409 `USER_HAS_FILES`**, whose message carries the file count for the
  client's warning dialog — replacing the previous FK-violation **500** (`23503`, an opaque
  "Internal server error"). `deleteFiles=false` counts as no confirmation; the flag is a
  validated string literal (`'true' | 'false'`) rather than a boolean because the global
  pipe's `enableImplicitConversion` measurably truthiness-casts `"false"` to `true` before
  any custom `@Transform` — `delete-user-query.dto.spec.ts` pins that behavior. An account
  owning no files deletes exactly as before. `USER_DELETE` audit rows now carry
  `detail: files=N`. No schema change (the FK keeps `ON DELETE NO ACTION`; the cascade is
  explicit in the service). E2E covers the refusal, the confirmed cascade, the invalid
  flag, and `deleteFiles=false`.
- Upload duplicate-submission policy (Stage 2 — mechanism hardening;
  [ADR 0019](ADR/0019-upload-claim-idempotency.md)): the filename `POST /upload/attach`
  issues is now a **one-shot claim token**, so `POST /file` has a defined retry contract
  with no new storage and no schema change. Resubmitting a claimed filename **replays**
  the existing file — HTTP **200** (not a second 201) with the original resource — for the
  user who claimed it, and returns the new **409 `FILE_ALREADY_CLAIMED`** for anyone else
  (identity-only: an admin re-posting someone else's filename is a conflict, not a retry).
  A well-formed filename with no temp file behind it (never issued, or swept past its TTL
  under [ADR 0018](ADR/0018-orphan-temp-file-cleanup.md)) fails as 400 `FILE_INVALID_PATH`
  before any write. `POST /upload/attach` stays deliberately non-idempotent — each call
  issues a new token and the unclaimed one is reclaimed by the sweep.
  `FileService.uploadFile` now returns `{ replayed, file }`; `FileController` maps
  `replayed` to the status via `@Res({ passthrough: true })` (the existing
  `AuthController` pattern). E2E covers submit-twice, the cross-user conflict, and both
  rejected-path cases.
- Orphan temp-file cleanup (Stage 2 — mechanism hardening;
  [ADR 0018](ADR/0018-orphan-temp-file-cleanup.md)): a new operational `TempCleanupModule`
  (`backend/temp-cleanup/`) runs a scheduled sweep that deletes unclaimed `temp_` files left
  in `file/temp` when `POST /file` is never called — the only unmanaged resource leak
  (ADR 0003). Uses `@nestjs/schedule` (new runtime dep, MIT; `cron@4.4.0` promoted to a
  direct dep under pnpm, the `multer` phantom-transitive precedent) with **imperative**
  `SchedulerRegistry` registration so the schedule, TTL, dry-run, and enable flag all come
  from config. Safety: only `temp_`-prefixed files past the TTL are deleted (double prefix
  guard: service skip + pure `selectExpiredTempFiles` re-check), `granted_`/`file/upload`
  never touched, `fs/promises` only, batched unlink, per-file failure isolated, `ENOENT`
  no-op, dry-run mode. Config (Joi + `.env.example`, all defaulted): `TEMP_SWEEP_ENABLED`
  (`true`), `TEMP_SWEEP_CRON` (`0 * * * *`, hourly), `TEMP_SWEEP_TTL_HOURS` (`24`),
  `TEMP_SWEEP_DRY_RUN` (`false`); e2e sets `TEMP_SWEEP_ENABLED=false`. `ScheduleModule.forRoot()`
  added to `AppModule`. Amends the module policy to admit operational/cross-cutting modules.
- Logging conventions (Stage 1 — observability;
  [ADR 0017](ADR/0017-logging-conventions.md)): Nest's built-in `Logger` is now used
  in `AllExceptionsFilter` — a 5xx is logged at `error` **with the stack** that stays
  out of the client response (Never Do Group 3), a 4xx at `debug` so routine
  auth/validation failures stay quiet. Only `status code method url` is logged, never
  bodies/headers/tokens. Establishes the level convention (`error`/`warn`/`log`/`debug`)
  for new code; structured/JSON output and external error tracking (Sentry) are deferred
  to Stage 4. No new dependency (Nest `Logger` is built in).
- GitHub Actions CI (Stage 1 — automated quality gate;
  [ADR 0016](ADR/0016-github-actions-ci.md)): `.github/workflows/ci.yml` runs on
  push/PR to `main`/`dev` with two jobs — `lint-and-unit` (new `lint:ci` script =
  `eslint` without `--fix`, then `pnpm test`) and `e2e` (the suite against a
  `postgres:16` service with a `pg_isready` healthcheck, env supplied inline). The
  toolchain comes from the ADR 0014 pin (`actions/setup-node` + `.nvmrc` + Corepack
  pnpm). The 0-error lint baseline and the unit + e2e suites are now enforced on
  every push/PR instead of by memory.
- Docker + docker-compose (Stage 1 — reproducibility;
  [ADR 0015](ADR/0015-docker-and-compose.md)): a multi-stage `Dockerfile` (build on
  `node:24.8.0`, `pnpm prune --prod`, slim runtime; `CMD` runs committed migrations
  then `node dist/main`) and a `docker-compose.yml` with a `db` service
  (`postgres:16`, named volume, healthcheck) and an `api` service (builds the image,
  waits on db health, `env_file: .env` with `DB_HOST=db` override, `./file` volume).
  `.dockerignore` keeps secrets/deps/uploads out of the image. Supersedes the manual
  `upload-board-pg` container and removes the e2e's manual-Postgres dependency. Base
  image tags come from the ADR 0014 pin. Verified: image builds, `bcrypt`'s native
  module runs in the slim runtime, `docker compose config` resolves.
- Node/pnpm toolchain pinning (Stage 1 — reproducibility;
  [ADR 0014](ADR/0014-node-pnpm-version-pinning.md)): `.nvmrc` (`24.8.0`, Node 24
  "Krypton" LTS), a `package.json` `engines` floor (`node >=24`, `pnpm >=10` —
  advisory, `engine-strict` stays off), and `packageManager` `pnpm@10.14.0`
  (Corepack). Closes the documented "versions are NOT pinned" gap and gives the
  upcoming Docker base-image tag and CI toolchain a single source of truth.
- Backend e2e suite rewritten (Stage 1 — test reliability): `test/app.e2e-spec.ts`
  (18 cases) plus a new `test/e2e-utils.ts` harness verify full request→response paths
  over real HTTP+DB — register/signin, refresh rotation & reuse (`AUTH_REFRESH_REUSED`,
  ADR 0012), RBAC ownership 403s (`FORBIDDEN_NOT_OWNER`/`FORBIDDEN`), list pagination,
  and the `temp_` → `granted_` physical promotion. Isolation strategy: a throwaway
  `upload_board_e2e` database, built by the real migrations and truncated between tests,
  dropped on teardown — the dev DB is never touched. Replaces the untouched Nest template
  (which targeted a nonexistent `GET /`). `test/jest-e2e.json` gains a `backend/*` module
  mapper and a uuid ESM-transform allowance; `eslint.config.mjs` relaxes the `no-unsafe-*`
  family for `test/**` only (supertest response bodies are `any`). Requires a local
  Postgres on 5435 — Docker-compose provisioning remains its own pending Stage 1 task.
- RBAC + audit log ([ADR 0013](ADR/0013-rbac-and-audit-log.md), Stage 0 —
  **Stage 0 complete**): `user`/`admin`/`superadmin` roles (string enum on the new
  `user_entity.role` column, migration `AddUserRoleAndAuditLog`); `RolesGuard` +
  `@Roles` and the `@AuthUser` decorator; ownership checks extended to "self/creator
  OR admin"; superadmin-only `PATCH /user/:id/role` (SERIALIZABLE tx, refuses to
  demote the last superadmin via new `AUTH_LAST_SUPERADMIN`, clears the target's
  refresh session). New append-only `audit_log_entity` (no FKs) records
  `ROLE_CHANGE`/`USER_DELETE`/`FILE_DELETE` after commit, exposed via admin-only
  paginated `GET /audit-log`. `GET /user` is now admin-only. `SuperadminSeedService`
  promotes the optional `SUPERADMIN_EMAIL` account on boot. No new dependencies.
- Refresh-token httpOnly cookie + rotation/reuse detection
  ([ADR 0012](ADR/0012-refresh-cookie-rotation.md), Stage F task 3 —
  **Stage F complete**): the refresh token now travels only as an httpOnly
  cookie (`SameSite=Strict`, `Path=/auth/token`, `Secure` in prod); its SHA-256
  is anchored in the new nullable `user_entity.refreshTokenHash` column
  (migration `AddUserRefreshTokenHash`); replaying a rotated-out token
  invalidates the session with 401 `AUTH_REFRESH_REUSED` (new code); new
  `POST /auth/signout` clears the anchor and the cookie. New runtime dependency
  `cookie-parser` (MIT).
- Machine-readable error-code contract
  ([ADR 0011](ADR/0011-error-code-contract.md), Stage F task 2): frozen
  `ErrorBody` response shape (`statusCode`/`code`/`message`/`timestamp`/`path`,
  `stack` in dev only), an 18-code string-enum catalog
  (`backend/common/error-code.ts`), and a global `AllExceptionsFilter` registered
  via `APP_FILTER` — 23 throw sites now attach `{ code, message }`; clients
  branch on `code`, never on `message`.
- [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md) — frontend split
  and API surface freeze (2026-07-23; structure amended 2026-07-24): the frontend
  lives as a `frontend/` subfolder in this same repository (backend stays at the
  root, untouched) with admin as an `/admin` route section inside it; four
  non-canonical routes are renamed then the API surface is frozen; a
  pnpm-workspace monorepo and an immediate three-way split were rejected.
- `frontend/` subfolder created 2026-07-24: React 19 + Vite + TypeScript SPA
  consuming the API (Basic signin, in-memory access token, httpOnly refresh
  cookie rotation), with its own scoped `frontend/CLAUDE.md`, `docs/API-CONTRACT.md`,
  and a Vite dev proxy — auth flow E2E-verified against the backend.
- TypeORM migration adoption ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md)):
  `migration:generate`/`run`/`revert`/`show` scripts (run against the compiled
  `dist/data-source.js`), CLI DataSource `backend/data-source.ts` (env via Node's
  built-in `process.loadEnvFile()` — no dotenv dependency), and baseline
  `backend/migrations/1784678400000-InitialSchema.ts`. Fresh DB: `pnpm migration:run`;
  pre-existing manually-created DB: `pnpm migration:run -- --fake` once.
  Replaces the manual "flip `synchronize` locally" workflow; unblocks RBAC.
- Documentation set: rewritten `README.md`, new `ARCHITECTURE.md`, `CHANGELOG.md`,
  `ROADMAP.md`, `CONTRIBUTING.md`, `ADR/` (9 records) — each with a Korean `.ko.md`
  sibling.

### Changed
- Backend source folder renamed `src/` → `backend/` for root symmetry with the
  `frontend/` subfolder (ADR 0010 amendment 2026-07-24): updated `nest-cli.json`
  sourceRoot, Jest `roots`/`moduleNameMapper`, the lint glob, `tsconfig.build.json`
  (now excludes `frontend`), the e2e import, all `backend/…` absolute imports,
  and every doc path. Compiled `dist/` layout and the `dist/data-source.js`
  migration path are unchanged; backend build/test(43)/lint and migrations
  re-verified.
- **Breaking** — auth transport (ADR 0012, pre-declared Stage F task with zero
  consumers): `POST /auth/signin` and `POST /auth/signin/local` response bodies
  shrink to `{ accessToken }` (refresh token moves to the Set-Cookie header);
  `POST /auth/token/refresh` reads the httpOnly cookie instead of a Bearer
  header. Browsers must send `credentials: 'include'` on refresh/signout.
  `AuthService.parseBearerToken` decomposed — the bare `verifyToken` core
  (secret + `type` claim) survives; the Bearer-splitting wrapper was removed.
- **Breaking** — route canonicalization before the API surface freeze
  ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md), Stage F
  task 1), decorator arguments only, guards/DTOs/handlers unchanged:
  - `POST /file/uploadFile` → `POST /file`
  - `PATCH /file/patch/:id` → `PATCH /file/:id`
  - `DELETE /file/delete/:id` → `DELETE /file/:id`
  - `POST /auth/token/refreshaccess` → `POST /auth/token/refresh`
- `ROADMAP.md` overhauled into the full project plan (11-axis decision review,
  2026-07-23): production-oriented target, five new design-criteria axes
  (observability, reproducibility, API contract stability, test reliability,
  performance/capacity), staged dedicated-task list (RBAC → foundation →
  mechanism hardening → board-domain expansion → AWS production transition),
  storage port-adapter declared as a future architecture goal. Related docs
  synced: `CLAUDE.md` (roadmap/CI/storage notes), `README.md` (stale
  known-limitations fixed), `CONTRIBUTING.md` (migration-based setup).
- `ROADMAP.md` amended for the frontend split (ADR 0010, 2026-07-23): new
  **Stage F — Frontend preparation** (route cleanup & contract freeze,
  error-code system, refresh-token cookie move + rotation) inserted ahead of
  Stage 0; RBAC re-sequenced after Stage F (it changes no API surface);
  refresh-token rotation pulled forward out of Stage 2; unauthenticated static
  file serving documented as an accepted known constraint until Stage 4.
  Related docs synced: `CLAUDE.md`, `README.md`.

### Fixed
- `GET /file` pagination is now deterministic ([ADR 0021](ADR/0021-list-query-search-filter-sort.md)).
  The query had **no `ORDER BY` at all**, and `OFFSET`/`LIMIT` over an unordered query has
  undefined row order in PostgreSQL — paging could repeat a row on one page and skip another.
  The default is now `createdAt DESC` with `file.id` appended as a tiebreaker (omitted when
  sorting by `id`, which is already unique), so rows tying on the sort column cannot reorder
  between two page requests. Existing callers now receive ordered results where they
  previously received arbitrary ones; the response shape and every existing parameter are
  untouched.
- `DELETE /file/:id` now removes the stored file, not just its row
  ([ADR 0020](ADR/0020-account-deletion-cascade.md)): every file deletion used to leave its
  `granted_` file in `file/upload` forever — still publicly served by `ServeStaticModule`,
  and never reclaimed (the ADR 0018 sweep only ever touches `temp_` files in `file/temp`).
  The unlink runs after the row is gone and is best-effort: a failure is logged at `warn`
  and leaves an orphan rather than undoing a committed delete. Paths outside `file/upload/`
  are refused — a reachable case, since `UpdateFileDto` accepts a bare `granted_` name.
- `POST /file` no longer answers 500 on foreseeable client sequences
  ([ADR 0019](ADR/0019-upload-claim-idempotency.md)): resubmitting a claimed filename with
  a different title used to insert the row, fail the `rename` with `ENOENT` and collapse to
  `INTERNAL_ERROR`, and two simultaneous submits both passed the unlocked title pre-check
  so the loser's `QueryFailedError` (not an `HttpException`) also became a 500. The unique
  violation (`23505`) is now inspected: if the winner claimed the same filename the loser
  is the same request twice and is replayed, otherwise it is a genuine 400
  `FILE_TITLE_TAKEN`.
- Auth responses are now serialized: `AuthController` lacked
  `ClassSerializerInterceptor`, so `POST /auth/register` leaked the bcrypt
  `password` hash (pre-existing) and the new `refreshTokenHash` — `@Exclude`
  is inert without the interceptor. Found by live verification of the
  ADR 0012 flow.
- Refresh tokens now carry a random `jti` claim: two tokens issued within the
  same second were byte-identical (same `sub`/`type`/`iat`/`exp` → same
  signature), which blinded rotation reuse detection.

### Security
- `UploadFileDto.filePath` is pinned to the attach-issued shape
  (`^temp_{uuid}_{ms}\.(mp4|mov|webm)$`, [ADR 0019](ADR/0019-upload-claim-idempotency.md)).
  It previously had no format validation while flowing into
  `join(cwd, 'file/temp', filePath)` as a `rename` source, so a client-supplied `../`
  segment could register a `FileEntity` row pointing at another user's `granted_` file.
  The "filePath values are server-constructed" premise (Never Do Group 3) is now enforced
  at the DTO boundary. `UpdateFileDto` omits and redeclares the field — PATCH takes
  `granted_` names, the opposite lifecycle state.
- `pnpm audit --prod` is clean (2026-07-24): `multer` promoted to a direct
  dependency (it is imported directly by `upload.module.ts` but was only a
  phantom transitive dep — crashed `node dist/main` under pnpm's strict
  layout) and pinned `^2.2.0`; runtime-reachable advisories pinned via
  `pnpm.overrides` (`body-parser`, `path-to-regexp`, `file-type`, `lodash`,
  `diff`, scoped `@nestjs/swagger>js-yaml`); in-range updates for
  `@nestjs/common`/`core`/`platform-express` (11.1.28), `typeorm` (0.3.31),
  `joi` (18.2.3), `uuid` (13.0.2). Dev-transitive findings intentionally
  remain (build/test-time only).

## [0.0.1] — development line

### 2026-07-22 — `da676c0` … `d97916d` (hardening & quick fixes)
- **Security**: runtime CVE findings pinned via `pnpm.overrides` (`jws ^3.2.3`,
  `validator ^13.15.22`); `POST /upload/attach` now enforces an mp4/mov/webm
  mimetype + extension allowlist (`da676c0`).
- **Fixed**: zero-error lint baseline reached (unsafe-`any` chains typed,
  `unbound-method` disabled for spec files); `GET /file` list now joins `creator`,
  matching `GET /file/:id` (`063ca14`).
- **Fixed**: `@nestjs/jwt` moved from `devDependencies` to `dependencies` — it is a
  runtime dependency of AuthModule; `--prod` installs no longer break (`44a0ac9`).
- **Refactor**: `FileService.uploadFile`/`updateFile` post-commit re-reads moved
  outside the transaction `try` with explicit null guards, replacing the
  `saved!`/`updated!` non-null assertions (`d97916d`).
- **Docs**: gaps/roadmap sync after the hardening run, chat-remnant removal plan,
  `.ko.md` documentation convention added to `CLAUDE.md` (`dc336ef`, `837fd14`).

### 2026-07-22 — `0549ca4`, `48ab8b7`, `7bbc6b6`
- **Added**: ownership checks, schema-free
  ([ADR 0007](ADR/0007-ownership-checks-without-rbac.md)): `PATCH /user/:id` and
  `DELETE /user/:id` are now self-only; `PATCH /file/patch/:id` and
  `DELETE /file/delete/:id` are now creator-only (`ForbiddenException` on mismatch).
- **Added**: pagination on `GET /file` via new `GetFilesDto` — `take` 1–100
  (default 20), `skip` ≥ 0 (default 0); closes the unpaginated-list known gap.
- **Added**: opt-in CORS ([ADR 0008](ADR/0008-opt-in-cors.md)): optional
  `CORS_ORIGIN` env var (comma-separated allowlist); CORS stays disabled when unset.
  Added to the Joi schema and `.env.example`.
- **Changed**: test suites aligned with current service signatures; `bcrypt` mocked
  via `jest.mock('bcrypt')`; tests for the deleted `UserService.create` removed
  (30 tests passing).
- **Changed**: README endpoint list corrected to the real routes (no `POST /user`).
- **Fixed**: `pnpm lint` restored — the unified `typescript-eslint` package
  `eslint.config.mjs` imports is now declared in `devDependencies`; lint runs again,
  surfacing ~45 pre-existing errors kept as a known gap (see [ROADMAP.md](ROADMAP.md)).
- **Style**: Prettier applied repo-wide via the restored `pnpm lint --fix`;
  `CLAUDE.md` roadmap synced (ownership checks marked landed).

### 2026-07-22 — `f3fff1c`
- `CLAUDE.md` rewritten as a repo-specific operating contract (was generic).
- **Fixed**: `@UserId` decorator now reads the JWT-populated `request.user.id` and
  throws `UnauthorizedException` when no authenticated user exists — identity can no
  longer be spoofed via the request payload.
- Roadmap decisions recorded: migration adoption, ownership checks, RBAC
  (see [ROADMAP.md](ROADMAP.md)).

### 2026-06-16 — `c8eb19f`, `4d00bc2`
- Added `CLAUDE.md` (initial AI-collaboration guidance).
- **Refactor (SOLID & NestJS principles)**:
  - DI fix: `AuthModule` now imports `UserModule` instead of re-declaring
    `UserService` in its own `providers[]`.
  - Added `FileResponseDto` + `FileService.toResponse()` — public file URLs composed
    from `BASE_URL` (new optional env var) instead of a hardcoded `@Transform` on the
    entity.
  - Entity cleanup: removed the duplicate `FileEntity.user` / `UserEntity.files`
    relation pair and entity-level presentation decorators.
  - Removed `UserService.create` (registration is `POST /auth/register` only);
    `UserService.update` re-hashes via configured `HASH_ROUNDS` (was hardcoded salt).
  - Type safety: `issueToken` narrowed to `Pick<UserEntity, 'id'>`; typed local-login
    request; assorted `any` removals.

### 2026-04-14 — `2f2fc99`
- **Changed**: `synchronize` flipped `true` → `false` in `app.module.ts` — the schema
  is no longer auto-altered at boot (see [ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md)).

### 2026-03-24 — `d1e830d`
- **Removed**: `GET /auth/profile` endpoint (unused role-experiment leftover).
- Minor `FileService` cleanup.

### 2026-03-17 — `3d4d5c1`, `595e7fb`
- **Removed**: placeholder `upload.controller.spec.ts`.
- Auth controller/service and `main.ts` cleanups; README updates.

### 2026-01-05 — `8b3b633`
- README edits (commit message: "few changes" — diff is README-only).

### 2025-12-27 — `6528b96`
- README edit (one line).

### 2025-12-19 — `283e9ab`, `88b327a`
- **Fixed**: duplicate file-title error — `updateFile` now checks for an existing
  title before applying it.
- Added `@IsString`/`@IsNotEmpty` validation decorators to `FileEntity`; comment pass
  over `FileService`.
- Removed committed sample media from `file/temp` / `file/upload` (note: `88b327a`'s
  message says "swagger additional update", but its diff only removes tracked media).

### 2025-12-18 — `0a77627`
- Added `.env.example`; README cleanup.

### 2025-12-17 — `434c2bc`
- **Initial application**: NestJS app with four modules —
  - `AuthModule`: Basic-token register/sign-in, dual-secret JWT pair with `type`
    claim, `jwt`/`local` Passport strategies, refresh endpoint.
  - `UserModule`: user CRUD behind `JwtAuthGuard`, bcrypt hashing, `@Exclude`d password.
  - `FileModule`: file metadata CRUD; two-phase `temp_` → `granted_` promotion inside
    manual QueryRunner transactions.
  - `UploadModule`: Multer diskStorage to `file/temp` with server-generated names,
    100 MB limit.
  - Joi-validated config, `ServeStaticModule` over `file/`, Swagger at `/doc`,
    Jest unit tests for the three services.

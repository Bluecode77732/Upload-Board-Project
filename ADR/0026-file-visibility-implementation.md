# ADR 0026: File visibility implementation — serving mechanism, metadata filtering, and the content/metadata disclosure split

- Status: Accepted
- Date: 2026-08-01
- 한국어: [0026-file-visibility-implementation.ko.md](0026-file-visibility-implementation.ko.md)

## Context

[ADR 0025](0025-file-visibility-and-media-expansion.md) was a design gate (no code) covering
five decisions (D1–D6). D1 (three visibility states), D3 (share token), and D6's
`FILE_SHARE_INVALID` code are implemented as written. Two things were left for this
implementation task:

1. **D2's open sub-decision** — whether a genuinely public file is *also* served from a
   separate static directory, or whether all granted reads route through
   `GET /file/:id/content`. ADR 0025 recorded a recommendation ("the simpler, single-
   correct-path option") but explicitly did not decide it.
2. **A gap ADR 0025's text does not cover at all** — the design gate only ever discusses
   *content* bytes ("every stored file is served publicly", D2's access check). It says
   nothing about whether `GET /file` (the list) and `GET /file/:id` (metadata) should also
   respect visibility. Before writing code it became clear this matters: those two
   endpoints currently return every file's title and creator email to any authenticated
   user, regardless of visibility. Leaving that as-is would make "private" a name without
   a property — a stranger could not read the *bytes* of a private file, but could still
   browse its title and who made it.

This ADR is the implementation-time settlement of both. Media-type expansion (ADR 0025
D4/D5 — image/audio field types) is a separate, not-yet-scheduled task; nothing here
touches the upload allowlist or field names.

## Decision

### D2 resolved: a single access-controlled endpoint, no separate public static directory

`GET /file/:id/content` is the only path that serves granted bytes. `ServeStaticModule`
now roots at `file/temp` only (`backend/app.module.ts`); `file/upload` is not mounted
anywhere. A public file's bytes still go through `FileService.resolveContentAccess`, which
skips the check for `visibility: 'public'` but still enforces the row exists and streams
through the same Range-aware code path as private/unlisted.

Chosen for the reasons ADR 0025 already recorded as the argument for this option: one
code path is easier to reason about and test than two, and a parallel static directory
would need its own sync-on-visibility-change logic (copy in on toggling to public, delete
on toggling away) that the single-endpoint design does not need at all. The performance
cost (every public read now goes through Nest/Express instead of a static file server) is
accepted without measurement — this is a portfolio-scale project with no traffic
justifying the added complexity, and revisiting this is possible later without touching
the private/unlisted paths at all.

### D7 (new): metadata endpoints filter by visibility too

`GET /file` and `GET /file/:id` now hide `private` and `unlisted` rows from anyone who is
not the creator or admin+. A non-owner's `GET /file` listing simply omits those rows;
`GET /file/:id` on a hidden row answers 404 `FILE_NOT_FOUND` (see D8 below).

`unlisted` is filtered the same as `private` here, not treated as "visible metadata, gated
content" — the name is "un-*listed*", and letting it appear in the general listing for any
logged-in user would defeat that word while adding no capability (a party with the actual
share link never needed the listing to find the file).

Rejected alternative: leave metadata endpoints unfiltered and gate content only, matching
ADR 0025's literal text. Rejected because a toggle whose only observable effect is "the
bytes 403" while the title and creator email remain world-readable does not match what an
owner reasonably expects from switching a file to private, and no part of ADR 0025's
stated goal 3 ("toggle... between private and public") suggests metadata should be
exempt — the ADR simply never considered the question.

### D8 (new): content and metadata disclose non-access differently, on purpose

- **Metadata** (`GET /file/:id`) answers **404 `FILE_NOT_FOUND`** for a file the requester
  cannot see. This is the existence-hiding choice ADR 0025 D6 flagged as undecided,
  resolved here in favor of hiding: the metadata endpoints are the vector by which a
  stranger could otherwise enumerate the catalog, so confirming "id 42 exists, you may
  just not read it" back to an unauthorized caller leaks more than the byte-access
  question ADR 0025 was written around.
- **Content** (`GET /file/:id/content`) answers **403 `FORBIDDEN_NOT_OWNER`** for a
  private file requested by a non-owner/non-admin, and **403 `FILE_SHARE_INVALID`** for a
  missing/wrong/expired unlisted token. Content confirms existence but refuses the bytes.
  This matches the existing 403 pattern `updateFile`/`deleteFile` already use for the same
  ownership question, rather than introducing a second, content-specific existence-hiding
  behavior. An unlisted file never answers 404 for a bad token, because "unlisted" is
  defined as reachable-by-token, not reachable-by-guessing — 404 there would incorrectly
  suggest the id itself was wrong rather than the token.

The two endpoints are allowed to disagree because they answer different questions: the
metadata endpoints are the discovery surface (should a stranger even learn this file
exists), while the content endpoint is the one place D1's three-way access rule has to be
enforced regardless of how the id was learned (a post reference, an old bookmark, a
share link someone forwarded). Requiring one disclosure policy across both would force
either a metadata leak or a content-endpoint behavior change with no argument behind it.

### Guard shape for anonymous content access

`GET /file/:id/content` needs to work with no `Authorization` header at all (public, and
unlisted-with-token), which the class-level `JwtAuthGuard` on `FileController` forbids for
every other route in that controller. Rather than restructure that guard placement,
content access lives in its own `FileContentController` (`backend/file/file-content.
controller.ts`), guarded by a new `OptionalJwtAuthGuard` (`backend/auth/guard/
optional-jwt-auth.guard.ts`) that verifies a bearer token when present but does not throw
when absent, and a matching `OptionalAuthUser` param decorator
(`backend/auth/decorator/optional-auth-user.decorator.ts`) mirroring the existing
`@AuthUser` decorator's read of `request.user`. The five existing `FileController` routes
are untouched.

## Alternatives rejected

- **Separate public static directory in addition to the endpoint** (D2's other option) —
  rejected per the reasoning above; recorded as reversible later if read performance on
  public files ever becomes a measured problem.
- **Metadata endpoints unfiltered** (D7's alternative) — rejected above.
- **One disclosure policy (404 everywhere, or 403 everywhere) across metadata and
  content** (D8's alternative) — rejected above; the two endpoints answer different
  questions and a shared policy would compromise one of them for no benefit.
- **A single `FileController` with per-method guard overrides** instead of a second
  controller — rejected as a larger diff against five working routes for the same
  outcome; Nest guards compose (class + method) rather than override, so making one route
  optional-auth while keeping the other five mandatory-auth on the same class means either
  moving `@UseGuards(JwtAuthGuard)` onto each of the five methods individually or building
  a guard that reads route-specific metadata to decide whether to throw. A second
  controller is the smaller, more legible change, and `CommentModule` already established
  the precedent of splitting a module's routes across two controllers when one shape
  doesn't fit all of them (there for a path-prefix reason, here for an auth-requirement
  reason).

## Consequences

- **Migration** `1785571437643-AddFileVisibility` adds `FileEntity.visibility` (varchar,
  default `'private'`), `shareToken` (nullable varchar), `shareExpiresAt` (nullable
  timestamptz). Reviewed line-by-line against `migration:generate`'s raw output; the
  spurious constraint/index rename statements the baseline's readable-name migrations
  always trigger (documented in CLAUDE.md > Architecture Decisions > Database) were
  stripped, leaving only the three `ADD COLUMN` statements.
- **`test/e2e-utils.ts`** gained the new migration in its `MIGRATIONS` list (no new table,
  so `TABLES` is unchanged) and a new `describe` block in `test/app.e2e-spec.ts` covering
  the visibility access matrix, share-token rotation, TTL expiry, and Range requests.
- **`FileResponseDto.fileUrl`** now points at `{BASE_URL}/file/:id/content` instead of a
  static `file/upload/...` path; a new `visibility` field is always present, and
  `shareUrl` is present only when the responder can manage the file and it is currently
  unlisted. Two existing e2e assertions that checked the old static-path shape were
  updated (`file.service.spec.ts`'s upload test and `app.e2e-spec.ts`'s post-attachment
  test).
- **This is a breaking change for `frontend/`**, on top of the one ADR 0025 already
  flagged for D5's field rename — `fileUrl`'s shape changed and a new `visibility` field
  appeared. Per ADR 0025's Consequences and CLAUDE.md > Project Overview, frontend
  adoption is a separate, frontend-scoped task; this task stops at the repo boundary.
- **New error code** `FILE_SHARE_INVALID` (403), added where it is thrown
  (`FileService.resolveContentAccess`), per the ADR 0011 catalog convention.
- **CLAUDE.md's File Storage section** is updated in the same change as this ADR to
  describe the landed behavior (content-endpoint serving, `file/upload` no longer static)
  instead of the "decided but not yet built" gate language, since the gate has now been
  passed for D1/D2/D3/D6. The D4/D5 media-type-expansion language stays as still-pending.

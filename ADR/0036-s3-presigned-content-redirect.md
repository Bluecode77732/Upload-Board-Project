# ADR 0036: Presigned S3 Redirect for `GET /file/:id/content`

- Status: Accepted (design-only — no code yet, mirrors ADR 0033/0034)
- Date: 2026-08-13
- Amends: [ADR 0025](0025-file-visibility-and-media-expansion.md) /
  [ADR 0026](0026-file-visibility-implementation.md) (the access-check contract
  `GET /file/:id/content` enforces is unchanged; only what happens after the check
  passes changes), and extends the `FileStorage` port from
  [ADR 0029](0029-storage-port-adapter.md) with one new method
- 한국어: [0036-s3-presigned-content-redirect.ko.md](0036-s3-presigned-content-redirect.ko.md)

## Context

ADR 0029 gave `S3Storage.createReadStream()` the same shape as
`LocalDiskStorage.createReadStream()`: both hand `FileContentController` a
`Readable`, which the controller pipes to the HTTP response. That parity was the
right call for ADR 0029's scope (a pure adapter swap, no behavior change) — but it
means that under `STORAGE_DRIVER=s3`, every byte of every granted file still
transits the Node process: the app server issues a `GetObjectCommand`, receives
the S3 response body, and re-streams it to the client. `S3` was adopted
specifically to move storage bandwidth off the app tier (ROADMAP.md §4,
Production DevOps stack), and the current proxy shape does not deliver that —
CPU and bandwidth for every video/audio/image read still concentrate on however
many API replicas are running, exactly the cost profile local disk already had.
The `S3Storage` row in ROADMAP.md's component-status table records the cutover
itself as the only remaining work; this ADR is a design gate that work must pass
through before the cutover is "done" in the sense the row's motivation actually
wants.

The fix discussed in a prior session and confirmed for this task: once
`resolveContentAccess` (`FileService`, ADR 0025 D1/D2) clears a request — for
**all three** visibility tiers, not just `public` — the content endpoint hands
the client a short-lived, S3-signed URL and redirects (302) to it instead of
proxying bytes itself. The browser (or `<video>`/`<audio>` element) then fetches
directly from S3. `LocalDiskStorage` has no equivalent concept, so
`STORAGE_DRIVER=local` keeps today's proxy-streaming behavior byte-for-byte
unchanged — this ADR is additive under `s3` only.

## Decision

### D1 — `FileStorage` gains one method: `getSignedReadUrl`

```typescript
getSignedReadUrl(key: string, contentType: string): Promise<string | null>;
```

- `LocalDiskStorage.getSignedReadUrl` always resolves `null` — local disk has no
  presigned-URL concept. Returning `null` (not throwing) is the sanctioned
  "adapter doesn't support this" signal, matching the existing pattern where a
  capability gap is a typed result, not an exception (c.f. `existsTemp`'s boolean
  contract).
- `S3Storage.getSignedReadUrl` calls `getSignedUrl` from
  `@aws-sdk/s3-request-presigner` (new dependency, D4) against a `GetObjectCommand`
  for `key`, with `ResponseContentType: contentType` so the redirected response
  carries the same `Content-Type` the controller already derives from
  `CONTENT_TYPE_BY_EXTENSION` today — S3 objects are written without an explicit
  `ContentType` at `PutObjectCommand` time (`S3Storage.saveTemp`), so this
  preserves the controller's existing behavior of deciding content type by
  extension, not by whatever (if anything) was stored at write time.
- Presigning is a local SigV4 computation, not a network round trip — issuing a
  signed URL costs no additional S3 request, so this does not reintroduce the
  `HeadObjectCommand` cost the current `stat()` call already pays before this
  change (see D2: `stat()`/`createReadStream()` are skipped entirely when a
  signed URL is issued).
- The TTL is **not** a parameter of this method. `S3Storage` reads it once at
  construction from `ConfigService` (D3) alongside `AWS_REGION`/`S3_BUCKET`,
  the same place ADR 0029 D3 already reads bucket/region — callers (the
  controller) never see or choose a TTL value, keeping that config detail an
  adapter-internal concern (Information Hiding).

### D2 — Controller flow: sign-then-redirect, fall back to streaming when `null`

In `FileContentController.getContent`, after `resolveContentAccess` returns the
file and the controller derives `contentType` (unchanged), it calls
`storage.getSignedReadUrl(file.filePath, contentType)` **before** calling
`storage.stat()`:

- Non-`null` → `res.redirect(302, signedUrl)` and return. `stat()` and
  `createReadStream()` are never called — S3 supplies its own `Content-Length`
  and honors any `Range` header the client sends directly against the presigned
  URL, so none of the controller's existing Range/206/416 logic runs on this
  path.
- `null` (always true for `LocalDiskStorage`) → today's `stat()` +
  Range-parse + `createReadStream()` flow, completely unchanged.

The access gate (`resolveContentAccess`) always runs first, exactly as today —
this ADR does not change who is allowed to reach the sign-or-stream branch, only
what happens once they're let through.

### D3 — TTL: `CONTENT_SIGNED_URL_TTL_SECONDS = 300`, a new env var

Asked and confirmed for this task (Documentation Authoring Protocol > 질문): a
flat 5-minute TTL, applied uniformly across all three visibility tiers — no
tiered expiry (e.g., shorter for `private`) was requested or designed.
Alternatives considered and their trade-offs:

| TTL | Trade-off |
|---|---|
| 60s | Tightest leak window, but re-signs on nearly every seek/reload past a minute — more `resolveContentAccess` round trips. |
| **300s (chosen)** | Covers a typical single-viewing session without mid-watch re-signing on a reasonable connection; leak window stays short. Same order of magnitude as this repo's other short-lived tokens. |
| 900s | Comfortable margin for slow playback/pauses; wider leak window. |
| 3600s | Minimizes re-signing almost entirely; a leaked private-file URL stays fetchable for an hour with no revocation mechanism. |

Follows the existing `TEMP_SWEEP_TTL_HOURS` convention (ADR 0018): a new Joi
schema entry (`Joi.number().default(300)`) plus a `.env.example` line, both in
the same change that implements this ADR — not env-gated to `STORAGE_DRIVER=s3`
specifically, since an unused numeric default is harmless when the local adapter
never reads it.

### D4 — New runtime dependency: `@aws-sdk/s3-request-presigner`

Official AWS SDK v3 package, same license family (Apache-2.0) as
`@aws-sdk/client-s3` already in `dependencies` (ADR 0029 Consequences) — no new
copyleft concern. Per Scope Discipline, adding it is implementation-time work
requiring its own `pnpm add` + `pnpm audit` check, not assumed here.

### D5 — Redirect status: `302 Found`, not `301`

A presigned URL is a single-purpose, time-boxed credential — caching the
redirect mapping (as a `301` invites intermediary proxies/CDNs to do) would be
both useless past the TTL and a needless persistence of a credential-bearing
URL somewhere outside this app's control. `302` signals "don't cache this
specific mapping," which matches the actual lifetime of what's being handed out.

### D6 — Explicitly out of scope / not decided here

- **Range-request behavior across the redirect for `frontend/`'s and `admin/`'s
  media consumers.** S3 honors `Range` headers on presigned `GetObject` URLs, and
  a browser's `<video>`/`<audio>` element is expected to re-issue its own Range
  requests directly against the signed URL after following the 302. Whether every
  browser/OS combination those two frontends' players run on handles a
  Range-seeking media element across a redirect boundary identically (some
  historical player/redirect interactions have been inconsistent, particularly
  around repeated re-resolution of the original `GET /file/:id/content` URL on
  each seek) is **unverified** — this ADR records the design and the risk, it
  does not test it. Verifying it, and any consumer-side fix if a gap is found, is
  explicit-request work in `frontend/`/`admin/`, outside this backend task's
  scope.
- **`STORAGE_DRIVER=local` behavior.** Completely unchanged — `getSignedReadUrl`
  always returns `null`, so every existing local-disk test and behavior (Range,
  206, 416, post-commit unlink) is untouched.
- **A CDN (CloudFront) in front of the bucket.** Not designed here; the signed
  URL points directly at the bucket. A CDN layer, if ever pursued, is separate,
  unscheduled Stage 4 work.
- **`FileResponseDto.fileUrl` / `FileService.toResponse()`.** Unchanged. `fileUrl`
  keeps pointing at `GET /file/:id/content` — the redirect happens entirely
  inside that endpoint's own handler; `file.service.ts` is not touched by this
  ADR at all.
- **Early revocation of an already-issued signed URL.** Not possible with SigV4
  presigned URLs — see Consequences below for the accepted trade-off this implies.

## Consequences

- **Security posture change for `private`/`unlisted` content, under
  `STORAGE_DRIVER=s3` only.** Today, every single byte-range request to
  `GET /file/:id/content` re-runs `resolveContentAccess` (a fresh JWT/share-token
  check per request). After this change, the *first* request still does — but the
  signed URL it returns is then fetchable by **anyone who obtains it** (a
  browser's network tab, a proxy log, a copied link) for up to
  `CONTENT_SIGNED_URL_TTL_SECONDS` (300s), with no further access check and no
  way to revoke it early. This is a materially different trust model for private
  content than the current design, accepted here specifically because the TTL is
  short (D3) and the cost being removed (bandwidth/CPU proxying through the app
  tier) is this ADR's whole point — documented so it is a known, chosen trade,
  not a silent regression discovered later.
- App-server bandwidth/CPU for granted-file reads drops to near zero under
  `STORAGE_DRIVER=s3` once this lands — no `GetObjectCommand` proxying, no
  `HeadObjectCommand` `stat()` call on the redirect path. This is the change's
  stated motivation.
- `local-disk.storage.spec.ts` and `s3.storage.spec.ts` each need a new test case
  for `getSignedReadUrl` (asserting `null` and asserting the signed-URL call
  shape respectively) once implemented — both files already exist and mock their
  respective SDKs/`fs/promises` (CLAUDE.md > Testing).
- `file-content.controller.ts` has no `*.spec.ts` today — controllers sit outside
  the coverage-measured layer (CLAUDE.md > Testing), so no new *unit* test
  obligation is created by this change, but the redirect branch should be
  exercised by `pnpm test:e2e` once `STORAGE_DRIVER=s3` is exercised in CI (it
  currently is not — the e2e suite runs against the local adapter).
- ROADMAP.md's S3 component-status row gets a citation to this ADR, recording
  that the redirect design is now settled ahead of the cutover — see the same
  change's ROADMAP.md/.ko.md edit.
- No schema change, no change to `FileEntity`, no change to any DTO.

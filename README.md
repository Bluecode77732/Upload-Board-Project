![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat&logo=jest&logoColor=white)

# Upload Board Project

> 한국어 버전: [README.ko.md](README.ko.md)

A NestJS REST API where authenticated users upload and manage image, audio, and video
files. JWT auth (Passport), PostgreSQL via TypeORM, Multer disk storage, transaction-safe
file promotion, Swagger documentation. A local/portfolio backend project — no
deploy pipeline. A React + Vite browser frontend lives in the `frontend/`
subfolder of this repository ([ADR 0010](docs/ADR/0010-frontend-split-and-api-surface-freeze.md));
this README covers the backend at the repo root.

- Timeline: 6 weeks (initial build), ongoing refinement
- Skills: TypeORM, PostgreSQL, transactions, DTO validation, Passport, guards, Jest, Swagger

## Documentation

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module map, request flow, entities, conventions |
| [ADR/](docs/ADR/README.md) | Architecture decision records — the *why* behind the design |
| [CHANGELOG.md](docs/CHANGELOG.md) | Version history |
| [ROADMAP.md](docs/ROADMAP.md) | Full staged project plan and known gaps |
| [CONTRIBUTING.md](docs/CONTRIBUTING.md) | Development workflow and conventions |
| [SESSION-LOG.md](docs/SESSION-LOG.md) | Auto-logged record of when each Claude Code session started or resumed, and on which branch |
| [CLAUDE.md](CLAUDE.md) | Operating contract for AI-assisted development |

Each document has a Korean sibling (`*.ko.md`).

## Features

- **Authentication** — register/sign-in via HTTP Basic token; dual-secret JWT
  access/refresh pair with a `type` claim ([ADR 0002](docs/ADR/0002-dual-secret-token-pair.md))
- **Two-phase upload** — `temp_` → `granted_` prefix state machine; the DB insert and
  the physical file move commit or roll back together
  ([ADR 0003](docs/ADR/0003-two-phase-upload-contract.md))
- **RBAC + audit log** — `user`/`admin`/`superadmin` roles; ownership checks
  extend to "self or admin"; role changes and deletes are audited
  ([ADR 0013](docs/ADR/0013-rbac-and-audit-log.md), layered on
  [ADR 0007](docs/ADR/0007-ownership-checks-without-rbac.md))
- **Boundary validation** — global `ValidationPipe` (`whitelist` +
  `forbidNonWhitelisted`); serialized entities never leak `password`
- **Swagger** — full API documentation and manual test bench at `/doc`

## Quick Start

Prerequisites: Node.js 24 (see [.nvmrc](.nvmrc)) and pnpm 10 via Corepack, plus
PostgreSQL 16 — or just Docker (see [With Docker](#with-docker) below).

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env        # then fill in DB credentials and token secrets

# 3. Ensure the storage folders exist at the repo root:
#      file/temp/    (temporary uploads)
#      file/upload/  (promoted files)

# 4. Create the database, then apply the schema via migrations (ADR 0006)
#    Create the database named in DB_DATABASE (createdb / pgAdmin), then:
#      pnpm migration:run
#    If your database already carries the schema from the pre-migration era:
#      pnpm migration:run -- --fake     # marks the baseline as applied, once

# 5. Run the dev server (port 3000)
pnpm run start:dev

# 6. Open Swagger UI
#    http://localhost:3000/doc

# Tests
pnpm test              # unit tests
pnpm run test:cov      # coverage (only services are measured)
```

### With Docker

`docker compose` brings up Postgres and the API together ([ADR 0015](docs/ADR/0015-docker-and-compose.md)).
Stop the legacy `upload-board-pg` container first — it holds host port 5435.

```bash
cp .env.example .env        # fill in secrets; DB_* can stay as-is for compose
docker compose up --build   # db (postgres:16) → migrate (one-shot) → api on :3000
```

The `db` service publishes `${DB_PORT}` (5435), so host-run `pnpm test:e2e` and
`pnpm migration:*` reach the same database. Migrations run as their own `migrate`
service, not inside `api`'s boot ([ADR 0032](docs/ADR/0032-migration-as-separate-deploy-step.md))
— `api` waits for `migrate` to exit 0. The image runs as a non-root user
([ADR 0030](docs/ADR/0030-container-non-root-and-arch-stance.md)); on a native Linux host, if
the bind-mounted `./file` directory fails to write, `chown` it once:
`sudo chown -R 1001:1001 file/` (Windows/Mac Docker Desktop is unaffected).

### Environment variables

Required (Joi-validated at boot — missing vars fail fast): `ENV`, `DB_TYPE`
(`postgres`), `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`,
`HASH_ROUNDS`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`,
`ACCESS_TOKEN_SECRET_EXPIRES_IN`, `REFRESH_TOKEN_SECRET_EXPIRES_IN`.

Optional (all Joi-validated with a default, or gated by their own condition — see
`.env.example` for the full list with examples): `BASE_URL` (default
`http://localhost:3000`; composes public file URLs), `PORT` (default `3000`),
`CORS_ORIGIN` (unset = CORS disabled; comma-separated allowlist —
[ADR 0008](docs/ADR/0008-opt-in-cors.md)), `SUPERADMIN_EMAIL` (unset = disabled;
promotes that account to superadmin on boot —
[ADR 0013](docs/ADR/0013-rbac-and-audit-log.md)), `TEMP_SWEEP_ENABLED` /
`TEMP_SWEEP_CRON` / `TEMP_SWEEP_TTL_HOURS` / `TEMP_SWEEP_DRY_RUN` (orphan temp-file
sweep — [ADR 0018](docs/ADR/0018-orphan-temp-file-cleanup.md)), `STORAGE_DRIVER`
(`local` default | `s3`, with `S3_BUCKET`/`AWS_REGION` required when `s3` —
[ADR 0029](docs/ADR/0029-storage-port-adapter.md)), and
`CONTENT_SIGNED_URL_TTL_SECONDS` (S3 presigned-redirect TTL, unused under `local` —
[ADR 0036](docs/ADR/0036-s3-presigned-content-redirect.md)).

## API Endpoints

All endpoints except `/auth/*` require a Bearer access token.

**Authentication** — the refresh token travels only as an httpOnly cookie
(`SameSite=Strict`, `Path=/auth/token`); browsers must call refresh/signout with
`credentials: 'include'` ([ADR 0012](docs/ADR/0012-refresh-cookie-rotation.md))
- `POST /auth/register` — register with a Basic token (`base64(email:password)`)
- `POST /auth/signin` — get `{ accessToken }` + refresh cookie (Basic token)
- `POST /auth/signin/local` — same, via body credentials (Passport local strategy)
- `POST /auth/token/refresh` — rotates the refresh cookie, returns a new access
  token; replaying a rotated-out token invalidates the session (`AUTH_REFRESH_REUSED`)
- `POST /auth/signout` — invalidates the server-side session anchor and clears
  the cookie (Bearer access token)

**User** — user creation is `POST /auth/register`; there is no `POST /user`.
Roles: `user` / `admin` / `superadmin` ([ADR 0013](docs/ADR/0013-rbac-and-audit-log.md))
- `GET /user` — list users (admin only). `take` (1–100, default 20) and `skip` (default 0)
  paginate; `search` does a case-insensitive partial match on email (wildcards escaped);
  `sortBy` (`createdAt`|`email`|`id`, default `createdAt`) and `order` (`ASC`|`DESC`,
  default `DESC`) control sort, with `id` always added as a tiebreaker — the same
  search/sort shape `GET /file` already has
  ([ADR 0021](docs/ADR/0021-list-query-search-filter-sort.md)). An undeclared query param is
  rejected as 400 `VALIDATION_FAILED` rather than silently ignored — the global
  `ValidationPipe`'s `forbidNonWhitelisted` treats a typo like `?orderby=email` as an
  error. Response is a `[users, totalCount]` tuple, matching `GET /file`
- `GET /user/:id` — get a user
- `PATCH /user/:id` — update a user (self, or an admin/superadmin acting on a
  strictly lower-ranked account — an admin cannot modify a peer admin or a superadmin)
- `PATCH /user/:id/role` — assign a role (superadmin only; the last superadmin cannot be demoted)
- `DELETE /user/:id` — delete a user (self, or an admin/superadmin acting on a
  strictly lower-ranked account, with the same peer/higher-rank restriction as above).
  An account that owns files is
  refused with 409 `USER_HAS_FILES` unless the request confirms the cascade with
  `?deleteFiles=true`, which deletes the account together with its files — irreversibly
  ([ADR 0020](docs/ADR/0020-account-deletion-cascade.md)). The account's **posts are always
  deleted with it**, with no confirmation of their own: the flag deliberately guards
  media bytes only ([ADR 0023](docs/ADR/0023-board-domain-schema.md)). A confirmed cascade is
  still refused with 409 `USER_FILES_IN_USE` when one of the account's files is attached
  to *another user's* post — delete that post first
  ([ADR 0024](docs/ADR/0024-account-cascade-fk-refusal.md))

**File**
- `POST /upload/attach` — upload a file to temp storage, 100 MB limit. Exactly one of three
  multipart fields, each with its own class allowlist: `image` (jpg/jpeg/png/webp), `audio`
  (mp3), `video` (mp4/mov/webm). Zero fields is 400 `UPLOAD_FILE_REQUIRED`; more than one is
  400 `UPLOAD_MULTIPLE_FIELDS`; a file that does not match its field's allowlist is 400
  `UPLOAD_INVALID_TYPE` ([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.md) D4/D5,
  [ADR 0027](docs/ADR/0027-media-type-expansion-implementation.md))
- `GET /file` — list files. All query parameters are optional and combinable; an undeclared
  one is rejected as 400 `VALIDATION_FAILED` ([ADR 0021](docs/ADR/0021-list-query-search-filter-sort.md))

  | Parameter | Values | Default |
  |---|---|---|
  | `take` | 1–100 | `20` |
  | `skip` | ≥ 0 | `0` |
  | `search` | title substring, case-insensitive, ≤100 chars (`%` and `_` match literally) | — |
  | `sortBy` | `createdAt` \| `title` \| `id` | `createdAt` |
  | `order` | `DESC` \| `ASC` | `DESC` |
  | `creatorId` | user id | — |

  Example: `GET /file?search=holiday&creatorId=3&sortBy=title&order=ASC&take=10`
- `GET /file/:id` — get file metadata. A `private`/`unlisted` file is 404 `FILE_NOT_FOUND`
  for anyone but its creator/admin — existence itself is hidden
  ([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.md),
  [ADR 0026](docs/ADR/0026-file-visibility-implementation.md))
- `GET /file/:id/content` — stream the file's stored bytes, gated by `visibility`: `public`
  needs no auth, `private` needs a creator/admin Bearer token (403
  `FORBIDDEN_NOT_OWNER` otherwise), `unlisted` needs a matching `?share=<token>` (no login
  required; 403 `FILE_SHARE_INVALID` if missing/wrong/expired). Supports `Range` requests
  for video/audio seeking. This is the **only** path that serves granted bytes —
  `ServeStaticModule` no longer exposes `file/upload`
  ([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.md) D1/D2,
  [ADR 0026](docs/ADR/0026-file-visibility-implementation.md)). Under `STORAGE_DRIVER=s3`,
  a passing access check returns a `302` redirect to a short-lived presigned S3 URL
  instead of streaming the bytes itself; under the default `local` driver, behavior is
  unchanged ([ADR 0036](docs/ADR/0036-s3-presigned-content-redirect.md))
- `POST /file` — promote a temp file to permanent storage (transactional), defaulting to
  `visibility: private`. The attached filename is a one-shot claim token: resubmitting it
  returns the existing file with 200 (idempotent retry) for the user who claimed it, and
  409 `FILE_ALREADY_CLAIMED` for anyone else ([ADR 0019](docs/ADR/0019-upload-claim-idempotency.md)).
  The response's `mediaType` (`image`/`audio`/`video`) is derived from the file's extension
  server-side, never client-supplied ([ADR 0040](docs/ADR/0040-persisted-media-type-for-playback.md))
- `PATCH /file/:id` — update file metadata (creator or admin), including toggling
  `visibility`. Switching to `unlisted` issues a `shareToken` (returned as `shareUrl`, owner/
  admin only); `rotateShareToken: true` regenerates it, invalidating every previously shared
  link; an optional `shareExpiresAt` bounds it (default: no expiry)
  ([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.md) D3)
- `DELETE /file/:id` — delete file metadata and the stored file (creator or admin). A file
  attached to a post is refused with 409 `FILE_IN_USE` — delete the post first
  ([ADR 0023](docs/ADR/0023-board-domain-schema.md))

**Post** — the board itself ([ADR 0023](docs/ADR/0023-board-domain-schema.md)). A post carries
text plus an optional reference to **one** file the author created; the file is *referenced*,
never owned, so deleting a post leaves it intact
- `GET /post` — list posts. Same query-parameter contract as `GET /file` above
  (`take` / `skip` / `search` / `sortBy` / `order` / `creatorId`), with the same defaults
- `GET /post/:id` — get a post with its author and attached file
- `POST /post` — create a post (`{ title, body, fileId? }`). `fileId` must be a file the
  requester created (403 `FORBIDDEN_NOT_OWNER` otherwise, 404 `FILE_NOT_FOUND` if it does not
  exist) and one no other post holds. It doubles as the idempotency key: resubmitting the
  **identical** payload returns the existing post with 200, while the same `fileId` with
  different text is 409 `POST_FILE_TAKEN`. A post without `fileId` has no natural key, so a
  repeat creates a second post
- `PATCH /post/:id` — update `title` / `body` (author or admin). The attachment is fixed at
  creation; detaching a video means deleting the post
- `DELETE /post/:id` — delete a post (author or admin), irreversibly. Its comments go with
  it through the FK cascade; its attached file does not

**Comment** — the thread under a post ([ADR 0023](docs/ADR/0023-board-domain-schema.md)). Flat —
there are no replies to replies
- `GET /post/:postId/comment` — list one post's comments, **oldest first** (the opposite of
  the newest-first file and post lists; the order is fixed and takes no sort parameters).
  `take` / `skip` paginate. 404 `POST_NOT_FOUND` if the post does not exist
- `POST /post/:postId/comment` — comment on a post (`{ body }`, ≤1,000 chars). 404
  `POST_NOT_FOUND` if the post is gone. A comment has no unique column and therefore no
  idempotency key, so an identical resubmission creates a **second** comment
- `PATCH /comment/:id` — update `body` (author or admin)
- `DELETE /comment/:id` — delete a comment (author or admin), irreversibly. The post is
  untouched

A post's author gets **no** special power over the comments on their post — editing and
deleting are the comment author's or an admin's, and nobody else's.

**Audit log**
- `GET /audit-log` — review ROLE_CHANGE / USER_DELETE / FILE_DELETE / POST_DELETE /
  COMMENT_DELETE records (admin only; paginated, `?action` filter). `?userId` returns
  only records where that user was the actor or the target (the two filters AND
  together when both are given)

**Health** (operational — for load-balancer/orchestrator probes, not application
consumers; unauthenticated by design, [ADR 0031](docs/ADR/0031-health-and-readiness-endpoints.md))
- `GET /health/live` — the process is running; no dependency checks
- `GET /health/ready` — additionally checks DB connectivity; 503 if unreachable

### Typical flow

```
POST /auth/register   (Basic)          → user created
POST /auth/signin     (Basic)          → { accessToken } + Set-Cookie: refreshToken (httpOnly)
POST /upload/attach   (Bearer, one of image/audio/video) → { filename: "temp_..." }
POST /file            (Bearer, { title, filePath: "temp_..." })
                                       → promoted (visibility: private); served at
                                         {BASE_URL}/file/:id/content (Bearer required until
                                         PATCH /file/:id sets visibility to public/unlisted)
```

### Error responses

Every error follows a frozen machine-readable shape
([ADR 0011](docs/ADR/0011-error-code-contract.md)):

```json
{
  "statusCode": 400,
  "code": "FILE_TITLE_TAKEN",
  "message": "Title already in use.",
  "timestamp": "2026-07-23T09:00:00.000Z",
  "path": "/file/1"
}
```

Branch on `code` (stable contract — see `backend/common/error-code.ts`), never on
`message` (free to change). Validation failures use `code: "VALIDATION_FAILED"`
with a `message` array; when `ENV=dev` a `stack` field is included.

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full request and data flow.

## Stack

- **NestJS** (Express platform) — modular monolith: Auth / User / File / Upload,
  split by single responsibility
- **TypeORM + PostgreSQL** — `synchronize: false`; manual QueryRunner transactions
  where a filesystem side effect must commit with the DB write
  ([ADR 0004](docs/ADR/0004-transaction-pattern-selection.md))
- **Passport** — `jwt` and `local` strategies behind `JwtAuthGuard` / `LocalAuthGuard`
- **Multer** — disk storage with server-generated filenames (`temp_{uuid}_{timestamp}`)
- **Jest** — unit tests colocated as `*.spec.ts`; repository/QueryRunner mocks, no DB access
- **Swagger** — `/doc`, with `persistAuthorization` for a persistent Bearer session

## Known Limitations

Tracked in [ROADMAP.md](docs/ROADMAP.md) — since 2026-07-23 the full staged project
plan. Highlights: **Stage 1 foundation is complete** — toolchain pinning,
Docker/compose, CI (GitHub Actions), logging conventions, and the e2e rewrite all
landed 2026-07-25 (ADR 0014–0017), and the e2e suite covers the
auth/ownership/pagination/promotion paths. **Stage 2 has begun** — orphan temp-file
cleanup landed 2026-07-26 ([ADR 0018](docs/ADR/0018-orphan-temp-file-cleanup.md)).
**File visibility landed 2026-08-01** — every stored file now has a
`public`/`private`/`unlisted` state (default `private`) and is served only through the
access-controlled `GET /file/:id/content`; `file/upload` is no longer statically exposed
([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.md) D1/D2/D3/D6,
[ADR 0026](docs/ADR/0026-file-visibility-implementation.md)). **Media-type expansion also
landed 2026-08-01** — `POST /upload/attach` now takes one of three type-specific fields
(`image`/`audio`/`video`), each with its own allowlist
([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.md) D4/D5,
[ADR 0027](docs/ADR/0027-media-type-expansion-implementation.md)). Both changes are breaking
for the live `frontend/` consumer, which has not yet adopted either. **Container hardening
landed 2026-08-08** — non-root image user, liveness/readiness endpoints, and migrations
moved to their own deploy step ([ADR 0030](docs/ADR/0030-container-non-root-and-arch-stance.md)–
[ADR 0032](docs/ADR/0032-migration-as-separate-deploy-step.md)); a distroless runtime base, a
real secrets manager, and HTTPS termination stay open items ([ADR 0033](docs/ADR/0033-secrets-delivery-target.md),
[ADR 0034](docs/ADR/0034-https-termination-stance.md), and ROADMAP.md > Unscheduled for
distroless). `pnpm lint` is clean as of 2026-07-22.

## Author

BLUECODE77732 — https://github.com/Bluecode77732

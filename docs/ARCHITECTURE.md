# Architecture

> 한국어 버전: [ARCHITECTURE.ko.md](ARCHITECTURE.ko.md)

A single-package NestJS REST API for authenticated file upload, board posts, and comments.
JWT auth (Passport), PostgreSQL via TypeORM, Prometheus metrics, Swagger documentation.

This document describes only the backend at the repo root. Two other projects live in the
same git repository but are not part of it: a React + Vite frontend in `frontend/` (ADR
0010), and an imported admin console in `admin/` (ADR 0022). Neither is a pnpm workspace —
each has its own `package.json`, its own tooling, and is built and tested on its own. Nothing
below is affected by either.

Design decisions and their reasoning live in [ADR/](ADR/). This document describes the
*current* structure; planned work lives in [ROADMAP.md](ROADMAP.md).

## Module Map

```
AppModule
├── ConfigModule        — global env, Joi-validated at boot (.env.example is the reference)
├── TypeOrmModule        — PostgreSQL, synchronize: false; DB_SSL turns on TLS to the DB (ADR 0039)
├── ServeStaticModule    — serves only file/temp at /file/temp; granted files have no static URL (ADR 0025/0026)
├── ScheduleModule       — powers TempCleanupModule's cron job
├── ThrottlerModule      — global rate limiting, 100 req/min default (5/min auth, 15/min upload); THROTTLE_ENABLED bypasses it for e2e (ADR 0053/0054)
├── AuthModule           — tokens + RBAC: Basic parsing, JWT issue/verify, Passport strategies, role guard (ADR 0013)
├── UserModule           — user CRUD, role assignment
├── FileModule           — file metadata: rows, visibility, media type, the promote-from-temp transaction
├── PostModule           — a board post's text plus its optional attached file (ADR 0023)
├── CommentModule        — comment text hanging off a post (ADR 0023)
├── UploadModule         — receives the physical bytes and stages them as a temp object
├── AuditLogModule       — append-only trail for privileged actions (role changes, deletes)
├── TempCleanupModule    — sweeps orphaned temp uploads on a cron (ADR 0018)
├── HealthModule         — /health/live and /health/ready for probes (ADR 0031)
├── MetricsModule        — /metrics for Prometheus (ADR 0047)
├── APP_FILTER           — AllExceptionsFilter shapes every thrown error into the ErrorBody contract (ADR 0011)
└── APP_GUARD            — ThrottlerGuard rate-limits every route except health/metrics; the app's first global guard (ADR 0053)
```

One module doesn't show up in that tree because it isn't wired into `AppModule` directly:
**StorageModule** hosts the `FileStorage` port (local disk or S3, picked by `STORAGE_DRIVER`)
and is imported individually by `UploadModule`, `FileModule`, `UserModule`, and
`TempCleanupModule` — whichever module needs to touch a physical file goes through it (ADR
0029).

The module split follows single responsibility on purpose (see `CLAUDE.md` > Module
Responsibility): a change that touches both "the physical file" and "the file's metadata" is
two modules' work by design, not a shortcut through one.

### AuthModule (`backend/auth/`)

| Route | Auth | Behavior |
|---|---|---|
| `POST /auth/register` | Basic token | Parses `Basic base64(email:password)`, rejects a duplicate email, bcrypt-hashes with `HASH_ROUNDS`, saves the user |
| `POST /auth/signin` | Basic token | Validates credentials, returns `{ accessToken }`, sets the httpOnly refresh cookie |
| `POST /auth/token/refresh` | httpOnly refresh cookie | Rotates the pair (reuse detection) — new cookie, new access token |
| `POST /auth/signout` | Bearer access token | Clears the stored refresh-token hash and the cookie |

- `AuthService` (`backend/auth/auth.service.ts`) is where all of this lives:
  `parseBasicToken`, `validateUser`, `issueToken(user: Pick<UserEntity, 'id' | 'role'>,
  isRefreshToken)`, `verifyToken(token, isRefreshToken)`, `issueTokenPair`,
  `rotateRefreshToken`, `signOut`, `register`, `signIn`.
- Access and refresh tokens are signed with **separate secrets** and carry
  `payload.type: 'access' | 'refresh'`. `verifyToken` checks both the secret and the type, so a
  refresh token can never be replayed as an access token ([ADR 0002](ADR/0002-dual-secret-token-pair.md)).
- The access token also carries a `role` claim, so a client can read its own role without an
  extra request ([ADR 0028](ADR/0028-access-token-role-claim.md)).
- The refresh token only ever travels as an httpOnly cookie (`SameSite=Strict`,
  `Secure` in prod). Its SHA-256 is anchored on `UserEntity.refreshTokenHash`; replaying a
  rotated-out token invalidates the whole session with 401 `AUTH_REFRESH_REUSED`
  ([ADR 0012](ADR/0012-refresh-cookie-rotation.md)). One session per account.
- **RBAC (ADR 0013)**: three roles — `user` / `admin` / `superadmin` — ranked by
  `ROLE_RANK` (`backend/auth/role/role.ts`). `RolesGuard` + `@Roles(min)` enforce a minimum
  rank on a handler; a handler with no `@Roles` imposes nothing beyond `JwtAuthGuard`. The
  `@AuthUser()` decorator hands a handler `{ id, role }` straight from the validated JWT —
  never from the request body.
- Strategies: `JwtStrategy` (`"jwt-auth-guard"`, loads the user via `UserService.findOne`,
  strips `password`). `JwtModule.register({})` is deliberately empty — the secret is
  supplied per call, since two different secrets are in play.

### UserModule (`backend/user/`)

All routes sit behind `JwtAuthGuard`.

| Route | Behavior |
|---|---|
| `GET /user` | **Admin only** — listing exposes every account's email. Paginated, with search/sort matching `GetFilesDto`'s shape (ADR 0021 parity) |
| `GET /user/:id` | Any authenticated user |
| `PATCH /user/:id` | Self, or an admin acting on a strictly lower-ranked account. Re-hashes the password via `HASH_ROUNDS` if one is supplied |
| `PATCH /user/:id/role` | **Superadmin only** — the sole path that changes `UserEntity.role`. Refuses to demote the last superadmin, and clears the target's refresh session immediately (ADR 0013) |
| `DELETE /user/:id` | Self or admin, hard delete. An account that owns files needs `?deleteFiles=true`, which cascades into its post/comment/file rows and stored files; without it, 409 `USER_HAS_FILES` (ADR 0020) |

- There is deliberately **no `POST /user`** — registration only happens through
  `POST /auth/register`.
- `UserService.remove` owns the deletion transaction and delegates to `CommentService`,
  `PostService`, and `FileService` in that order — comments first, because an account's
  comments on *someone else's* post aren't reachable through the post FK cascade otherwise.
  Stored files are unlinked only after the transaction commits ([ADR 0020](ADR/0020-account-deletion-cascade.md), [ADR 0023](ADR/0023-board-domain-schema.md)).
- `UserModule` exports `UserService` — that's its one public contract, consumed by
  `JwtStrategy` for token validation.

### FileModule (`backend/file/`)

Two controllers, split by auth requirement rather than by prefix ([ADR 0026](ADR/0026-file-visibility-implementation.md)):

**FileController** — behind `JwtAuthGuard`:

| Route | Behavior |
|---|---|
| `GET /file` | Paginated list, with title search and creator/sort filters (ADR 0021). A non-owner/non-admin never sees a `private`/`unlisted` row |
| `GET /file/:id` | Metadata + creator. Hidden from a non-owner/non-admin as 404, not 403 — existence itself stays private |
| `POST /file` | Promotes an attached temp file: one DB insert plus the physical move, together. The temp filename is a one-shot claim token — resubmitting it replays (200) for whoever claimed it first, and 409s (`FILE_ALREADY_CLAIMED`) for anyone else (ADR 0019) |
| `PATCH /file/:id` | Creator or admin. Title, `granted_` filePath, ownership reassignment, and the visibility toggle all go through this one endpoint — there's no separate visibility-only route |
| `DELETE /file/:id` | Creator or admin, hard delete. The row goes first, then the stored file is unlinked (ADR 0020) |

**FileContentController** — behind `OptionalJwtAuthGuard` (works with or without a bearer token):

| Route | Behavior |
|---|---|
| `GET /file/:id/content` | The only path that actually returns a file's bytes |

- Every stored file has a `visibility`: `public` / `private` / `unlisted` (default `private`,
  so a fresh upload is unreachable until its owner opens it up). `resolveContentAccess` is the
  one gate every read has to clear: public needs nothing, private needs the owner or an admin,
  unlisted needs a matching `?share=<token>` and no login at all ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.md)/[ADR 0026](ADR/0026-file-visibility-implementation.md)).
- `mediaType` (`image` / `audio` / `video`) is derived from the file's extension at upload time
  and never trusted from the client — it's what the frontend uses to pick the right `<img>` /
  `<audio>` / `<video>` tag ([ADR 0040](ADR/0040-persisted-media-type-for-playback.md)).
- The controller doesn't touch the filesystem directly. It asks the `FileStorage` port for a
  presigned URL first; if the adapter can give one (S3 only), it 302-redirects and never reads
  a byte itself. If not (local disk), it falls back to `stat()`/`createReadStream()` with full
  Range support — 206 partial content for video/audio seeking, 416 for an out-of-range request
  ([ADR 0029](ADR/0029-storage-port-adapter.md), [ADR 0036](ADR/0036-s3-presigned-content-redirect.md)).
- `FileService.uploadFile` / `updateFile` use a manual QueryRunner transaction because the
  physical `rename`/`promote` has to sit *inside* the DB transaction boundary — it's the one
  place a non-DB side effect needs that ([ADR 0004](ADR/0004-transaction-pattern-selection.md)).
  Deletion is the opposite: the row is dropped first and the physical unlink only runs after
  commit, because unlink can't be rolled back.
- Responses are shaped by `FileService.toResponse()` into `FileResponseDto`. `fileUrl` points
  at the content endpoint, never a static path; `shareUrl` only appears for a manager of an
  `unlisted` file.

### PostModule (`backend/post/`)

All routes sit behind `JwtAuthGuard`.

| Route | Behavior |
|---|---|
| `GET /post` | Paginated, newest-first list — title search, creator filter, sort (same shape as `GET /file`) |
| `GET /post/:id` | The post, its author, and its attached file |
| `POST /post` | Creates a post, optionally attaching one file the requester owns. Attaching the same file twice with identical content replays (200) instead of erroring — a post has no natural idempotency key beyond that (ADR 0023) |
| `PATCH /post/:id` | Author or admin |
| `DELETE /post/:id` | Author or admin. Its comments go with it through a DB-level cascade; the attached file is left untouched — a post references a file, it doesn't own it |

- `PostService` never looks at `file.creator` directly — whether a file may be attached is
  `FileModule`'s call (`assertAttachableBy`), and `PostModule` only asks, never reaches through
  the relation itself ([ADR 0023](ADR/0023-board-domain-schema.md)).
- `PostModule` exports `PostService` for `UserModule`'s account-deletion cascade.

### CommentModule (`backend/comment/`)

Two controllers for two different URL prefixes — a thread hangs off its post, but an existing
comment is addressed by its own id:

| Route | Behavior |
|---|---|
| `GET /post/:postId/comment` | Oldest-first (a thread reads in writing order), fixed order — no sort parameters |
| `POST /post/:postId/comment` | Creates a comment. No natural idempotency key, so an identical resubmit just makes a second comment (documented and accepted, same call as a post with no attached file) |
| `PATCH /comment/:id` | Author or admin |
| `DELETE /comment/:id` | Author or admin |

- `CommentModule` asks `PostModule` whether a post exists (`assertPostExists`) rather than
  querying `post_entity` itself — the same "ask, don't reach through" rule `PostModule` follows
  toward `FileModule`.
- The comment→post foreign key is the schema's only database-level `ON DELETE CASCADE`: a
  comment has no existence outside its post, so nothing needs reading before the rows go
  ([ADR 0023](ADR/0023-board-domain-schema.md) D3).

### UploadModule (`backend/upload/`)

| Route | Behavior |
|---|---|
| `POST /upload/attach` | Attach exactly one of three multipart fields — `image`, `audio`, or `video`, each with its own extension/mimetype allowlist. 100MB limit. Returns `{ filename }` |

- Multer buffers into memory rather than writing to disk itself — the actual write happens
  through the `FileStorage` port (`UploadService.stageTemp`), so the temp file's very first
  byte already goes through whichever adapter is configured, not just the promoted copy
  ([ADR 0029](ADR/0029-storage-port-adapter.md) D4).
- The generated name is always `temp_{uuid}_{timestamp}.{ext}`. The client only ever echoes
  this name back on `POST /file` — it never gets to choose a path itself.

### StorageModule (`backend/storage/`)

Not a domain module — an operational one that every physical-file-touching module shares.

- `FileStorage` is the port: `saveTemp`, `existsTemp`, `promote`, `stat`,
  `createReadStream`, `unlink`, `listTemp`, and `getSignedReadUrl`. Every consumer injects the
  `FILE_STORAGE` token and never calls `fs/promises` directly.
- Two adapters sit behind it, picked by `STORAGE_DRIVER` (`local` default | `s3`):
  `LocalDiskStorage` (the original disk mechanics) and `S3Storage` (unit-tested with the SDK
  mocked, never yet run against a live bucket). `getSignedReadUrl` is the one method with
  genuinely different behavior — local returns `null` (no such concept), S3 returns a
  short-lived presigned URL ([ADR 0029](ADR/0029-storage-port-adapter.md), [ADR 0036](ADR/0036-s3-presigned-content-redirect.md)).

### AuditLogModule (`backend/audit-log/`)

An append-only trail for anything a privileged action does to someone else's data — role
changes, and file/post/comment deletes.

- Each row is `{ actorId, targetId, targetType, action, detail }`. `targetType` (`user` /
  `file` / `post` / `comment`) exists because `targetId` alone can't tell a file's id from a
  user's — without it, filtering by user could quietly match the wrong kind of row
  ([ADR 0045](ADR/0045-audit-log-target-type.md)).
- `actorId`/`targetId` are deliberately **not** foreign keys — hard-deleting a user must not
  take the audit trail describing that deletion down with it.
- `GET /audit-log` is admin-only. `AuditLogModule` exports `AuditLogService`, consumed by
  `UserModule`, `FileModule`, `PostModule`, and `CommentModule` wherever they record an action.

### TempCleanupModule (`backend/temp-cleanup/`)

Another operational module, not a domain one — kept separate so `UploadModule`'s own job stays
narrow (staging temp writes) rather than also owning their cleanup ([ADR 0018](ADR/0018-orphan-temp-file-cleanup.md)).

- `TempCleanupService` registers its own cron job on boot via `SchedulerRegistry` (schedule,
  TTL, and dry-run mode are all env-driven — `TEMP_SWEEP_*`). Every tick lists temp objects
  through the `FileStorage` port, so the sweep works the same way under either adapter.
- A `temp_` object nobody claimed within `TEMP_SWEEP_TTL_HOURS` gets deleted; a `granted_`
  object is never a candidate — the prefix itself is what makes "still `temp_`" a safe,
  DB-free signal that nothing owns it.

### HealthModule (`backend/health/`)

Deliberately unauthenticated — a kubelet or load-balancer probe carries no bearer token ([ADR 0031](ADR/0031-health-and-readiness-endpoints.md)).

| Route | Behavior |
|---|---|
| `GET /health/live` | No dependency checks — just "is the process answering HTTP" |
| `GET /health/ready` | Pings the DB; 503 if it's unreachable, so an orchestrator stops routing traffic here |

### MetricsModule (`backend/metrics/`)

Also unauthenticated, mirroring `HealthModule` — Prometheus scrapes carry no bearer token ([ADR 0047](ADR/0047-observability-prometheus-grafana.md)).

| Route | Behavior |
|---|---|
| `GET /metrics` | Prometheus exposition-format snapshot (`prom-client`) |

- A global `MetricsInterceptor` records per-request duration for every route.
- Two domain counters live where the events actually happen rather than being bolted on
  separately: `uploadClaimsTotal` in `FileService` (fresh vs. replayed claims) and
  `tempCleanupDeletedTotal` in `TempCleanupService`.

## Request Flow

### Security headers

Before any Nest guard runs, `helmet()` — plain Express middleware registered first in
`main.ts`'s `bootstrap()` — attaches the OWASP-recommended response header set
(`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Strict-Transport-Security`, etc.) to every response
([ADR 0055](ADR/0055-helmet-security-headers.md)). `script-src` is the one directive
widened past helmet's default (`'self' 'unsafe-inline'`) so `/doc`'s inline Swagger UI
bootstrap script still executes; every other directive stays default.

### Guard chain

Before any of the auth chain below, a global `ThrottlerGuard` (`APP_GUARD`) runs on every
request and rate-limits it — 100 requests/minute by default. It is a separate, orthogonal
layer from authentication: it runs whether or not the request carries a token, and a request
that fails it never reaches `JwtAuthGuard` ([ADR 0053](ADR/0053-global-rate-limiting.md)).
The 100/minute ceiling is **per route, not one pool shared by the whole app**: the
library's default key is a hash of controller class + handler method + client IP, so
`GET /file` and `POST /auth/signin` from the same client are two independent counters —
live-verified by driving `GET /file` past its own limit (429) and immediately confirming
`POST /auth/signin` from the same client was unaffected.

Two route groups override that default down, via `@Throttle({ default: { limit, ttl } })`
on the handler ([ADR 0054](ADR/0054-per-route-rate-limit-tuning.md)): `POST /auth/register`,
`POST /auth/signin`, and `POST /auth/token/refresh` allow 5 requests/minute (the credential-
check surface a brute-force attempt would target), and `POST /upload/attach` allows 15/minute
(each call writes a file to `file/temp` before any ownership check). `POST /auth/signout`
stays at the 100/minute default — it requires an already-valid access token, so it isn't a
credential-guessing surface. `THROTTLE_ENABLED=false` (the e2e-only bypass, see Config below)
is implemented as a module-level `skipIf` rather than inflating `limit`, so it disables both
the default and these per-route overrides uniformly.

Most controllers are class-level guarded:

```
Request → ThrottlerGuard (APP_GUARD, global — 100 req/min default per route, ADR 0053)
        → JwtAuthGuard (Passport "jwt-auth-guard")
        → JwtStrategy.validate (loads the user via UserService.findOne, strips password)
        → request.user
        → [RolesGuard + @Roles(min), only on handlers that declare one]
        → handler (@AuthUser() reads { id, role }; @UserId() reads id alone)
```

Three routes deliberately sit outside the *auth* chain: `GET /file/:id/content` uses
`OptionalJwtAuthGuard` so an unauthenticated visitor can still reach a public or unlisted
file, and `GET /health/*` / `GET /metrics` carry no auth guard at all, since neither a probe
nor a Prometheus scrape can present a bearer token. `GET /health/*` and `GET /metrics` are
also the only routes exempt from `ThrottlerGuard` itself (`@SkipThrottle()`) — a probe or
scrape is designed to repeat on a fixed interval for a pod's whole lifetime, and because the
limit is per-route, that repetition alone can run *that one route's own* ceiling dry (a tight
probe interval, or several replicas sharing an egress IP) — not a matter of competing with
unrelated app traffic, since no other route's calls count against it (ADR 0053).

Write authorization is ownership-based by default (self-only / creator-only), with RBAC
layered on top for the handful of routes that need more than that — a strictly higher role
than the target, or an admin-only listing ([ADR 0007](ADR/0007-ownership-checks-without-rbac.md), [ADR 0013](ADR/0013-rbac-and-audit-log.md)).

### Boundary validation

The global `ValidationPipe` (`backend/main.ts`) runs `transform + whitelist +
forbidNonWhitelisted + enableImplicitConversion`. A request field a DTO doesn't declare never
reaches a service — services trust validated input and don't re-check its shape.

### Error responses (`ErrorBody`)

Every thrown error — `HttpException` or not — exits through the global
`AllExceptionsFilter` and comes out shaped as `{ statusCode, code, message, timestamp, path }`,
plus `stack` when `ENV=dev`. A throw site attaches `{ code: ErrorCode.X, message }`; anything
thrown without one gets a status-based fallback, and a non-`HttpException` leaves only
`"Internal server error"` outward ([ADR 0011](ADR/0011-error-code-contract.md)). Clients
branch on `code` only — `message` is free to change.

### Two-phase upload (`temp_` → `granted_`)

```
1. POST /upload/attach   (multipart: image, audio, or video)
      └─ UploadService.stageTemp writes  file/temp/temp_{uuid}_{ts}.{ext}
         through the FileStorage port    → returns { filename }

2. POST /file  { title, filePath: <that filename> }
      └─ FileService.uploadFile, before any transaction (ADR 0019):
           already claimed by this user  → 200 replay of the existing row
           claimed by someone else       → 409 FILE_ALREADY_CLAIMED
           no temp object behind it      → 400 FILE_INVALID_PATH
         then, only for an unclaimed filename, inside one QueryRunner transaction:
           a. INSERT FileEntity  (filePath rewritten to file/upload/granted_...,
              mediaType derived from the extension, visibility defaults to private)
           b. storage.promote(temp key → granted key)
           c. commit   (rollback on failure; release() in finally)

3. The row's bytes are now reachable only through GET /file/:id/content,
   gated by its visibility (public / private / unlisted) — never a static URL.
```

The prefix is a state machine: `temp_` means "uploaded but unclaimed", `granted_` means "owned
by a DB row". Filenames are always server-generated — the client only ever echoes one back,
never chooses a path itself ([ADR 0003](ADR/0003-two-phase-upload-contract.md)). A `temp_`
object nobody claims is swept by `TempCleanupModule` once it ages past its TTL
([ADR 0018](ADR/0018-orphan-temp-file-cleanup.md)).

## Entities (TypeORM)

```
UserEntity                          FileEntity
├── id             PK               ├── id            PK
├── email          unique           ├── title         unique
├── password       @Exclude         ├── filePath      "file/upload/granted_..."
├── role            'user'|'admin'|'superadmin', default 'user' (ADR 0013)
├── refreshTokenHash  @Exclude, nullable (rotation anchor — ADR 0012)
├── creator        OneToMany ─────► ├── creator       ManyToOne (nullable: false, cascade: true)
├── createdAt                       ├── mediaType      'image'|'audio'|'video' (ADR 0040)
└── updatedAt                       ├── visibility     'public'|'private'|'unlisted', default 'private'
                                     ├── shareToken     nullable (only while unlisted — ADR 0025)
                                     ├── shareExpiresAt nullable
                                     ├── createdAt
                                     └── updatedAt

PostEntity                          CommentEntity
├── id             PK               ├── id            PK
├── title          not unique       ├── body          text, ≤1,000 chars (DTO-bounded)
├── body           text             ├── creator       ManyToOne (nullable: false)
├── creator        ManyToOne        ├── post          ManyToOne, ON DELETE CASCADE
├── file           OneToOne, nullable, unique          (the schema's only DB-level cascade)
├── createdAt                       ├── createdAt
└── updatedAt                       └── updatedAt
```

- `PostEntity`/`CommentEntity` relations are deliberately **unidirectional** — neither
  `UserEntity` nor `FileEntity` gains an inverse collection, since nothing ever queries one
  ([ADR 0023](ADR/0023-board-domain-schema.md)).
- `FileEntity.title` and `PostEntity.title` are not the same kind of unique: a file's title is
  unique across the whole table, a post's title isn't unique at all (one board where a title
  can only be used once, across every author, would be a bug, not a feature).
- `FileEntity`/`PostEntity` both carry a `(createdAt, id)` index and a `creator` index, plus a
  `pg_trgm` GIN index on `title` for search — all three measured and adopted after seeding
  10,000 rows and timing the real query shapes ([ADR 0049](ADR/0049-performance-capacity-criteria.md)).
  The trigram index only exists in the migration SQL; `@Index` can't express its operator
  class, so `migration:generate` will keep proposing to drop it — that's expected noise, not a
  real diff.
- No shared base entity — timestamps are declared per entity on purpose, since there's nothing
  else to share.
- Schema changes ship as TypeORM migrations (`backend/migrations/`, applied via
  `pnpm migration:run`); `synchronize: false` stays committed
  ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md)).

## Configuration

All env vars are Joi-validated at startup in `backend/app.module.ts`; a missing one throws on
boot. Access always goes through `ConfigService` (`getOrThrow` for required, `get` with a
default for optional) — never `process.env` directly.

Beyond the DB/JWT/hashing basics, a few groups exist for specific features:

- **Secret/hash strength** (added 2026-09-11): `HASH_ROUNDS` must be `>= 10`;
  `ACCESS_TOKEN_SECRET`/`REFRESH_TOKEN_SECRET` must each be at least 32 characters and
  contain a lowercase letter, an uppercase letter, a digit, and a symbol. Presence-only
  validation would let a short or all-numeric value through, silently weakening JWT
  signing or the bcrypt cost factor (Never Do Group 3) — a short/simple value now fails
  at boot with a Joi error naming the field, before the app ever tries to connect to
  the DB.
- **DB TLS**: `DB_SSL` (default off), `DB_SSL_CA` — required together when the target Postgres
  instance enforces encrypted connections, e.g. RDS's default (ADR 0039).
- **Storage adapter**: `STORAGE_DRIVER` (`local` default | `s3`), `S3_BUCKET`/`AWS_REGION`
  (required only when `s3`), `CONTENT_SIGNED_URL_TTL_SECONDS` (default 300 — how long a
  presigned content URL stays valid) (ADR 0029, ADR 0036).
- **Orphan sweep**: `TEMP_SWEEP_ENABLED` (default on), `TEMP_SWEEP_CRON`,
  `TEMP_SWEEP_TTL_HOURS` (default 24), `TEMP_SWEEP_DRY_RUN` (ADR 0018).
- **RBAC seed**: `SUPERADMIN_EMAIL` — optional; names the account `pnpm
  promote-superadmin` promotes to superadmin (a manual step, not automatic on boot —
  [ADR 0052](ADR/0052-superadmin-seed-manual-trigger.md)).
- **Rate limiting**: `THROTTLE_ENABLED` (default on) — not a dev/prod switch, it exists only
  so `test/e2e-env.ts` can bypass the global limit (and the tighter per-route auth/upload
  limits) for the e2e suite's several-hundred-request run, via a module-level `skipIf`
  ([ADR 0053](ADR/0053-global-rate-limiting.md), [ADR 0054](ADR/0054-per-route-rate-limit-tuning.md)).
- **Optional**: `BASE_URL` (default `http://localhost:3000`), `CORS_ORIGIN` (unset = CORS
  off; a comma-separated allowlist when a browser frontend needs it — ADR 0008).

A new env var always means updating the Joi schema and `.env.example` together, in the same
change.

## API Documentation

REST only, documented through Swagger at `/doc` (`persistAuthorization: true`, so a pasted
Bearer token survives a page reload) ([ADR 0009](ADR/0009-rest-only-api-with-swagger.md)).
Every controller carries `@ApiTags`; protected controllers add `@ApiBearerAuth`, Basic-token
endpoints add `@ApiBasicAuth`. `/doc` itself is **not** gated by `ENV` — it's this project's
only API documentation, not a debug tool to hide in prod.

## Testing

- Unit tests sit next to their source as `*.spec.ts`; Jest's config lives in `package.json`
  (`roots: ["backend"]`). Coverage only measures services and `backend/common/` — controllers,
  guards, strategies, DTOs, entities, and modules are thin framework glue, better exercised by
  e2e than by unit coverage.
- `fs/promises` and `bcrypt` are mocked (`jest.mock(...)`); `QueryRunner` is a plain object of
  `jest.fn()`s returned by a mocked `DataSource`. No test reaches a real database.
- `test/*.e2e-spec.ts` (`pnpm test:e2e`) hits a real, throwaway Postgres database instead —
  built by the real migrations, truncated between tests, dropped on teardown. It covers the
  auth/ownership/pagination/promotion paths end to end.

## Infrastructure

This document only covers how the backend itself is built — what actually runs it is covered
elsewhere, so it doesn't go stale in two places at once.

- **Local dev**: `docker-compose.yml` runs Postgres, a one-shot migration job, then the API
  ([ADR 0015](ADR/0015-docker-and-compose.md); hardened with a non-root user and a
  `/health/live`-based `HEALTHCHECK` — [ADR 0030](ADR/0030-container-non-root-and-arch-stance.md)/[ADR 0032](ADR/0032-migration-as-separate-deploy-step.md)).
- **CI**: GitHub Actions lints, runs unit and e2e tests, then builds and publishes a
  multi-arch Docker image ([ADR 0016](ADR/0016-github-actions-ci.md), extended by
  [ADR 0048](ADR/0048-ci-trigger-restoration-and-docker-publish-design.md)). There's still no
  CD step — nothing in CI ever runs `helm upgrade`.
- **Cloud deploy**: a Helm chart (`k8s/helm/`) and three separate Terraform root modules
  (`k8s/infra/terraform/`) can stand up a real EKS cluster with Prometheus/Grafana wired in
  (ADR 0041–0044, [ADR 0047](ADR/0047-observability-prometheus-grafana.md)). This has already
  been proven end to end once — then torn down to stop the AWS bill. Whether that
  infrastructure currently exists is a point-in-time fact, not something to assume from this
  paragraph; see `CLAUDE.md`'s Terraform entry or run `terraform plan` in each of the three
  directories.

Full detail lives in [README.md](../README.md) (Stack, Deployment) and
[ROADMAP.md](ROADMAP.md), not here — repeating it in both places is exactly how a document goes
stale twice instead of once.

# Architecture

> 한국어 버전: [ARCHITECTURE.ko.md](ARCHITECTURE.ko.md)

Single-package NestJS REST API for authenticated video-file upload and management.
JWT auth (Passport), PostgreSQL via TypeORM, Multer disk storage, Swagger documentation.
No deployment pipeline — a local/portfolio backend project. This document
describes the backend at the repo root; a React + Vite frontend lives in the
`frontend/` subfolder (ADR 0010) and is not a pnpm-workspace monorepo — the
backend layout below is unaffected by it.

Design decisions and their rationale are recorded in [ADR/](ADR/). This document
describes the *current* structure; planned work lives in [ROADMAP.md](ROADMAP.md).

## Module Map

```
AppModule
├── ConfigModule        — global, Joi-validated env (.env.example is the reference)
├── TypeOrmModule       — PostgreSQL, synchronize: false, entities: FileEntity, UserEntity, AuditLogEntity
├── ServeStaticModule   — serves ./file at URL prefix /file
├── AuthModule          — tokens only: Basic parsing, JWT issue/verify, Passport strategies; RBAC RolesGuard/@Roles + role enum (ADR 0013)
├── UserModule          — user CRUD only; role assignment (superadmin) + boot superadmin seed; exports UserService; imports FileModule for the account-deletion cascade (ADR 0020)
├── FileModule          — file *metadata* only: FileEntity rows + promote-from-temp transaction + deletion of rows and stored files; exports FileService (consumed by UserModule)
├── UploadModule        — *physical* files only: Multer diskStorage; controller-only, no DB
├── AuditLogModule      — append-only privileged-action trail; exports AuditLogService (consumed by User/File); admin-only GET /audit-log (ADR 0013)
└── APP_FILTER          — AllExceptionsFilter (backend/common/filter/): shapes every error into the ErrorBody contract (ADR 0011)
```

Module responsibility is a deliberate SRP split (see `CLAUDE.md` > Module Responsibility):
a change spanning "physical file" and "file metadata" is two modules' work by design.

### AuthModule (`backend/auth/`)

| Route | Auth | Behavior |
|---|---|---|
| `POST /auth/register` | Basic token | Parses `Basic base64(email:password)`, rejects duplicate email, bcrypt-hashes with `HASH_ROUNDS`, saves user |
| `POST /auth/signin` | Basic token | Validates credentials, returns `{ accessToken }` and sets the httpOnly refresh cookie |
| `POST /auth/signin/local` | Body credentials | Same via Passport `local-auth-guard` strategy |
| `POST /auth/token/refresh` | httpOnly refresh cookie | Rotates the pair (reuse detection) — new cookie + new access token |
| `POST /auth/signout` | Bearer access token | Clears the stored refresh-token hash and the cookie |

- `AuthService` (`backend/auth/auth.service.ts`): `parseBasicToken`, `verifyToken(token, isRefreshToken)`,
  `validateUser`, `issueToken(user: Pick<UserEntity, 'id'>, isRefreshToken)`, `issueTokenPair`,
  `rotateRefreshToken`, `signOut`, `register`, `signIn`.
- Access and refresh tokens are signed with **separate secrets** (`ACCESS_TOKEN_SECRET` /
  `REFRESH_TOKEN_SECRET`) and carry `payload.type: 'access' | 'refresh'`; `verifyToken`
  verifies with the matching secret **and** checks the `type` claim, so a refresh token can
  never be replayed as an access token ([ADR 0002](ADR/0002-dual-secret-token-pair.md)).
- The refresh token travels only as an httpOnly cookie (`refreshToken`: `SameSite=Strict`,
  `Path=/auth/token`, `Secure` in prod, `Max-Age` = refresh expiry); its SHA-256 is anchored
  in `UserEntity.refreshTokenHash`, and `POST /auth/token/refresh` rotates it — replaying a
  rotated-out token invalidates the whole session with 401 `AUTH_REFRESH_REUSED`
  ([ADR 0012](ADR/0012-refresh-cookie-rotation.md)). One session per account.
- Strategies: `JwtStrategy` (name `"jwt-auth-guard"`, validates access tokens, loads the user
  via `UserService.findOne`, strips `password`), `LocalStrategy` (name `"local-auth-guard"`).
- `JwtModule.register({})` is intentionally empty — secrets are supplied per call in
  `issueToken`, because two different secrets are in play.
- `AuthModule` imports `UserModule` for `UserService` (DI via `exports`/`imports`, never
  re-declaring another module's provider).

### UserModule (`backend/user/`)

All routes behind `JwtAuthGuard`; controller carries `ClassSerializerInterceptor` so
`UserEntity.password` (`@Exclude({ toPlainOnly: true })`) never leaves the API.

| Route | Behavior |
|---|---|
| `GET /user` | Paginated list — `GetUsersDto`: `take` 1–100 (default 20), `skip` ≥ 0 (default 0), `search` (case-insensitive partial match on email), `sortBy`/`order` (`createdAt`\|`email`\|`id`, default `createdAt` `DESC`), `id` as a tiebreaker — mirrors `GetFilesDto`'s shape (ADR 0021 parity) |
| `GET /user/:id` | Single user or 404 |
| `PATCH /user/:id` | **Self only** — re-hashes password via `HASH_ROUNDS` if provided |
| `DELETE /user/:id` | **Self or admin** — hard delete. An account owning files needs `?deleteFiles=true`, which cascades into its file rows and stored files; without it, 409 `USER_HAS_FILES` (ADR 0020) |

- There is deliberately **no `POST /user`** — registration is `POST /auth/register`.
- Self-only enforcement compares `@UserId()` (JWT identity) against the path id and throws
  `ForbiddenException` on mismatch ([ADR 0007](ADR/0007-ownership-checks-without-rbac.md)).
- The `@UserId` decorator (`backend/user/decorator/userId.decorator.ts`) reads
  `request.user.id` populated by `JwtStrategy.validate` — identity never comes from the body.
- `UserModule` exports `UserService`; that export is the module's public contract
  (consumed by `JwtStrategy` for token validation).
- `UserService.remove` owns the deletion transaction — `dataSource.transaction()`, since
  the boundary holds pure DB writes — and delegates the file rows to `FileService` rather
  than touching `FileEntity` itself, so file metadata stays FileModule's concern. The
  stored files are unlinked **after** the commit ([ADR 0020](ADR/0020-account-deletion-cascade.md)).

### FileModule (`backend/file/`)

All routes behind `JwtAuthGuard`.

| Route | Behavior |
|---|---|
| `GET /file` | Paginated list — `GetFilesDto`: `take` 1–100 (default 20), `skip` ≥ 0 (default 0) |
| `GET /file/:id` | Metadata + creator join, or 404 |
| `POST /file` | Promotes a temp file: DB insert + physical rename in one transaction. The filename is a one-shot claim token — a resubmit replays (200) for its claimant, 409 `FILE_ALREADY_CLAIMED` for others (ADR 0019) |
| `PATCH /file/:id` | **Creator only** — title (duplicate-checked), `granted_` filePath, ownership reassignment |
| `DELETE /file/:id` | **Creator or admin** — hard delete of the metadata row, then the stored `granted_` file is unlinked (ADR 0020) |

- `FileService.uploadFile` / `updateFile` use the **manual QueryRunner** transaction pattern
  (`createQueryRunner → connect → startTransaction → commit/rollback → release`, `release()`
  always in `finally`) because a non-DB side effect (the physical `rename`) must sit inside
  the transaction boundary ([ADR 0004](ADR/0004-transaction-pattern-selection.md)).
- Deletion takes the opposite side of that boundary: the physical `unlink` runs **after**
  the row is gone, because `unlink` cannot be rolled back — inside the transaction a commit
  failure would leave a row-less file, while outside it a failed unlink only leaves a
  recoverable orphan on disk (logged at `warn`). `unlinkStoredFiles`
  (`backend/common/unlink-stored-files.ts`) refuses paths outside `file/upload/`.
- `FileService.findStoredPathsOfCreator` / `deleteFilesOfCreator` take the caller's
  `EntityManager`, so the account cascade runs inside `UserService`'s transaction while the
  file-row rules stay here. Rows are deleted by `creatorId`, not by a previously read id
  list, so an upload racing the cascade cannot survive and re-trigger the FK violation
  ([ADR 0020](ADR/0020-account-deletion-cascade.md)).
- Responses are shaped by `FileService.toResponse()` into `FileResponseDto`, composing
  `fileUrl` as `{BASE_URL}/{filePath}` via `ConfigService`. Entities carry no presentation
  logic (the old `@Transform` URL on the entity was deliberately removed).

### UploadModule (`backend/upload/`)

| Route | Behavior |
|---|---|
| `POST /upload/attach` | Multipart field `video` → Multer diskStorage writes `file/temp/temp_{uuid}_{timestamp}.{ext}`, 100 MB limit, returns `{ filename }` |

- Controller-only module: no service, no DB access — by design, physical-file concerns
  never touch metadata concerns.
- Uploads enforce an mp4/mov/webm mimetype **and** extension allowlist via Multer's
  `fileFilter` (both values are client-supplied — an allowlist against misuse, not a
  content guarantee).

## Request Flow

### Guard chain

Every non-auth controller is class-level guarded:

```
Request → JwtAuthGuard (Passport "jwt-auth-guard")
        → JwtStrategy.validate (loads user via UserService.findOne, strips password)
        → request.user
        → handler (@UserId() reads request.user.id)
```

There are no roles — every authenticated user is equal. Write authorization is
ownership-based (self-only / creator-only) at the handler/service level
([ADR 0007](ADR/0007-ownership-checks-without-rbac.md)).

### Boundary validation

The global `ValidationPipe` (`backend/main.ts`) runs `transform + whitelist +
forbidNonWhitelisted + enableImplicitConversion` — a request field not declared on a DTO
never reaches a service. Services trust validated input (boundary-only validation).

### Error responses (`ErrorBody`)

Every thrown error — `HttpException` or not — exits through the global
`AllExceptionsFilter` (`backend/common/filter/all-exceptions.filter.ts`, registered via
`APP_FILTER` in `app.module.ts`) and is shaped into the frozen `ErrorBody` contract
(`backend/common/error-code.ts`): `{ statusCode, code, message, timestamp, path }`, plus
`stack` when `ENV=dev`. Throw sites attach `{ code: ErrorCode.X, message }`; exceptions
thrown without a code get a status-based fallback, a 400 carrying a message array is
labeled `VALIDATION_FAILED` (the ValidationPipe signature), and non-`HttpException`
errors leave only `"Internal server error"` outward
([ADR 0011](ADR/0011-error-code-contract.md)). Clients branch on `code` only — `message`
is free to change.

### Two-phase upload (`temp_` → `granted_`)

```
1. POST /upload/attach   (multipart "video")
      └─ Multer writes  file/temp/temp_{uuid}_{ts}.{ext}   → returns { filename }

2. POST /file  { title, filePath: <that filename> }
      └─ FileService.uploadFile, before any transaction (ADR 0019):
           0a. already claimed by this user → 200 replay of the existing row
               claimed by someone else     → 409 FILE_ALREADY_CLAIMED
           0b. no temp file behind it      → 400 FILE_INVALID_PATH
         then, for an unclaimed filename, inside one QueryRunner transaction:
           a. INSERT FileEntity  (filePath rewritten to file/upload/granted_...)
           b. rename file/temp/temp_...  →  file/upload/granted_...
           c. commit   (rollback on failure; release() in finally)
              on a 23505 race: replay if the winner took the same filename,
              else 400 FILE_TITLE_TAKEN

3. File served publicly at {BASE_URL}/file/upload/granted_...  (ServeStaticModule)
   API responses expose it as fileUrl in FileResponseDto.
```

The prefix is a state machine: `temp_` = "uploaded but unclaimed", `granted_` = "owned by
a DB row". Static serving exposes both folders, so the prefix is the only marker of a
file's lifecycle state. `UpdateFileDto.filePath` rejects `temp_` values and accepts only
`granted_` ones. Filenames are server-generated (uuid + timestamp) — the client only
echoes them back, so no client-chosen path segment ever reaches the filesystem
([ADR 0003](ADR/0003-two-phase-upload-contract.md)); that echo is enforced by
`@Matches(TEMP_FILENAME_PATTERN)` on `UploadFileDto.filePath`, so a malformed value is
rejected as `VALIDATION_FAILED` at the boundary ([ADR 0019](ADR/0019-upload-claim-idempotency.md)).
An unclaimed `temp_` file is reclaimed by the scheduled sweep
([ADR 0018](ADR/0018-orphan-temp-file-cleanup.md)).

## Entities (TypeORM)

```
UserEntity                          FileEntity
├── id          PK                  ├── id        PK
├── email       unique              ├── title     unique
├── password    @Exclude(toPlain)   ├── filePath  ("file/upload/granted_...")
├── refreshTokenHash  @Exclude, nullable (rotation anchor — ADR 0012)
├── creator     OneToMany ────────► ├── creator   ManyToOne (nullable: false, cascade: true)
├── createdAt                       ├── createdAt
└── updatedAt                       └── updatedAt
```

- The relation property is named `creator` on **both** sides — follow that naming.
- No shared base entity; timestamps are declared per entity.
- `FileEntity.creator` is `nullable: false` — deleting a user who still owns files will
  hit an FK constraint (documented hard-delete caveat, see `CLAUDE.md` > Scope Discipline).
- Schema management: `synchronize: false` is committed; schema changes ship as TypeORM
  migrations — CLI DataSource `backend/data-source.ts`, migrations in `backend/migrations/`
  (baseline `InitialSchema`), applied via `pnpm migration:run`
  ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md)).

## Configuration

- All env vars are Joi-validated at startup in `backend/app.module.ts`; missing vars throw on boot.
- Access is via `ConfigService` only (`getOrThrow` for required, `get` with default for
  optional) — never `process.env` directly.
- Optional vars: `BASE_URL` (default `http://localhost:3000`), `CORS_ORIGIN`
  (unset = CORS disabled; comma-separated allowlist when set —
  [ADR 0008](ADR/0008-opt-in-cors.md)).
- A new env var means updating **both** the Joi schema and `.env.example` in the same change.

## API Documentation

REST only, documented via Swagger at `/doc` (`persistAuthorization: true`)
([ADR 0009](ADR/0009-rest-only-api-with-swagger.md)). Every controller carries `@ApiTags`;
protected controllers `@ApiBearerAuth`; Basic-token endpoints `@ApiBasicAuth`.

## Testing

- Unit tests live alongside source as `*.spec.ts`; Jest config is embedded in `package.json`
  (`roots: ["src"]`). Coverage measures **services and `backend/common/`** (the exception
  filter and error-code catalog); controllers, guards, strategies, DTOs, entities, and
  modules are ignored via `coveragePathIgnorePatterns`.
- `fs/promises` is mocked with `jest.mock('fs/promises')`; `bcrypt` with `jest.mock('bcrypt')`.
- QueryRunner is mocked as a plain object of `jest.fn()`s returned by a mocked `DataSource`.
- Direct DB access in tests is forbidden — repository mocks only.

## Non-Existent Infrastructure (do not assume)

- No CI workflow, no Dockerfile, no git hooks, no deploy target.
- No logging infrastructure (no winston, no Nest `Logger` usage, no error tracking).

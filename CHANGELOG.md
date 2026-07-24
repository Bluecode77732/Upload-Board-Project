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
- Auth responses are now serialized: `AuthController` lacked
  `ClassSerializerInterceptor`, so `POST /auth/register` leaked the bcrypt
  `password` hash (pre-existing) and the new `refreshTokenHash` — `@Exclude`
  is inert without the interceptor. Found by live verification of the
  ADR 0012 flow.
- Refresh tokens now carry a random `jti` claim: two tokens issued within the
  same second were byte-identical (same `sub`/`type`/`iat`/`exp` → same
  signature), which blinded rotation reuse detection.

### Security
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

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

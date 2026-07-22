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
- Documentation set: rewritten `README.md`, new `ARCHITECTURE.md`, `CHANGELOG.md`,
  `ROADMAP.md`, `CONTRIBUTING.md`, `ADR/` (9 records) — each with a Korean `.ko.md`
  sibling.

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

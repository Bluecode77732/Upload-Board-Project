![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat&logo=jest&logoColor=white)

# Upload Board Project

> 한국어 버전: [README.ko.md](README.ko.md)

A NestJS REST API where authenticated users upload and manage video files.
JWT auth (Passport), PostgreSQL via TypeORM, Multer disk storage, transaction-safe
file promotion, Swagger documentation. A local/portfolio backend project — no
deploy pipeline. A React + Vite browser frontend lives in the `frontend/`
subfolder of this repository ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md));
this README covers the backend at the repo root.

- Timeline: 6 weeks (initial build), ongoing refinement
- Skills: TypeORM, PostgreSQL, transactions, DTO validation, Passport, guards, Jest, Swagger

## Documentation

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module map, request flow, entities, conventions |
| [ADR/](ADR/README.md) | Architecture decision records — the *why* behind the design |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [ROADMAP.md](ROADMAP.md) | Full staged project plan and known gaps |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow and conventions |
| [CLAUDE.md](CLAUDE.md) | Operating contract for AI-assisted development |

Each document has a Korean sibling (`*.ko.md`).

## Features

- **Authentication** — register/sign-in via HTTP Basic token; dual-secret JWT
  access/refresh pair with a `type` claim ([ADR 0002](ADR/0002-dual-secret-token-pair.md))
- **Two-phase upload** — `temp_` → `granted_` prefix state machine; the DB insert and
  the physical file move commit or roll back together
  ([ADR 0003](ADR/0003-two-phase-upload-contract.md))
- **RBAC + audit log** — `user`/`admin`/`superadmin` roles; ownership checks
  extend to "self or admin"; role changes and deletes are audited
  ([ADR 0013](ADR/0013-rbac-and-audit-log.md), layered on
  [ADR 0007](ADR/0007-ownership-checks-without-rbac.md))
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

`docker compose` brings up Postgres and the API together ([ADR 0015](ADR/0015-docker-and-compose.md)).
Stop the legacy `upload-board-pg` container first — it holds host port 5435.

```bash
cp .env.example .env        # fill in secrets; DB_* can stay as-is for compose
docker compose up --build   # db (postgres:16) + api on :3000; migrations run on boot
```

The `db` service publishes `${DB_PORT}` (5435), so host-run `pnpm test:e2e` and
`pnpm migration:*` reach the same database.

### Environment variables

Required (Joi-validated at boot — missing vars fail fast): `ENV`, `DB_TYPE`
(`postgres`), `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`,
`HASH_ROUNDS`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`,
`ACCESS_TOKEN_SECRET_EXPIRES_IN`, `REFRESH_TOKEN_SECRET_EXPIRES_IN`.

Optional: `BASE_URL` (default `http://localhost:3000`; composes public file URLs),
`CORS_ORIGIN` (unset = CORS disabled; comma-separated allowlist —
[ADR 0008](ADR/0008-opt-in-cors.md)), `PORT` (default 3000),
`SUPERADMIN_EMAIL` (unset = disabled; promotes that account to superadmin on boot —
[ADR 0013](ADR/0013-rbac-and-audit-log.md)).

## API Endpoints

All endpoints except `/auth/*` require a Bearer access token.

**Authentication** — the refresh token travels only as an httpOnly cookie
(`SameSite=Strict`, `Path=/auth/token`); browsers must call refresh/signout with
`credentials: 'include'` ([ADR 0012](ADR/0012-refresh-cookie-rotation.md))
- `POST /auth/register` — register with a Basic token (`base64(email:password)`)
- `POST /auth/signin` — get `{ accessToken }` + refresh cookie (Basic token)
- `POST /auth/signin/local` — same, via body credentials (Passport local strategy)
- `POST /auth/token/refresh` — rotates the refresh cookie, returns a new access
  token; replaying a rotated-out token invalidates the session (`AUTH_REFRESH_REUSED`)
- `POST /auth/signout` — invalidates the server-side session anchor and clears
  the cookie (Bearer access token)

**User** — user creation is `POST /auth/register`; there is no `POST /user`.
Roles: `user` / `admin` / `superadmin` ([ADR 0013](ADR/0013-rbac-and-audit-log.md))
- `GET /user` — list users (admin only)
- `GET /user/:id` — get a user
- `PATCH /user/:id` — update a user (self or admin)
- `PATCH /user/:id/role` — assign a role (superadmin only; the last superadmin cannot be demoted)
- `DELETE /user/:id` — delete a user (self or admin)

**File**
- `POST /upload/attach` — upload a video to temp storage (multipart field `video`, 100 MB limit)
- `GET /file` — list files (paginated: `take` 1–100, default 20 / `skip` default 0)
- `GET /file/:id` — get file metadata
- `POST /file` — promote a temp file to permanent storage (transactional)
- `PATCH /file/:id` — update file metadata (creator or admin)
- `DELETE /file/:id` — delete file metadata (creator or admin)

**Audit log**
- `GET /audit-log` — review ROLE_CHANGE / USER_DELETE / FILE_DELETE records (admin only; paginated, `?action` filter)

### Typical flow

```
POST /auth/register   (Basic)          → user created
POST /auth/signin     (Basic)          → { accessToken } + Set-Cookie: refreshToken (httpOnly)
POST /upload/attach   (Bearer, video)  → { filename: "temp_..." }
POST /file            (Bearer, { title, filePath: "temp_..." })
                                       → promoted; served at {BASE_URL}/file/upload/granted_...
```

### Error responses

Every error follows a frozen machine-readable shape
([ADR 0011](ADR/0011-error-code-contract.md)):

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

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full request and data flow.

## Stack

- **NestJS** (Express platform) — modular monolith: Auth / User / File / Upload,
  split by single responsibility
- **TypeORM + PostgreSQL** — `synchronize: false`; manual QueryRunner transactions
  where a filesystem side effect must commit with the DB write
  ([ADR 0004](ADR/0004-transaction-pattern-selection.md))
- **Passport** — `jwt` and `local` strategies behind `JwtAuthGuard` / `LocalAuthGuard`
- **Multer** — disk storage with server-generated filenames (`temp_{uuid}_{timestamp}`)
- **Jest** — unit tests colocated as `*.spec.ts`; repository/QueryRunner mocks, no DB access
- **Swagger** — `/doc`, with `persistAuthorization` for a persistent Bearer session

## Known Limitations

Tracked in [ROADMAP.md](ROADMAP.md) — since 2026-07-23 the full staged project
plan. Highlights: toolchain pinning and Docker/compose landed 2026-07-25 and the
e2e suite now covers the auth/ownership/pagination/promotion paths, while CI and
logging infrastructure are still pending (Stage 1 roadmap items).
**Uploaded files are served unauthenticated at public URLs**
(`{BASE_URL}/file/upload/granted_...`) until the Stage 4 VOD access-control task
— anyone with the link can fetch them ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)).
Uploads enforce an mp4/mov/webm allowlist and `pnpm lint` is clean as of
2026-07-22.

## Author

BLUECODE77732 — https://github.com/Bluecode77732

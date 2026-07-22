![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat&logo=jest&logoColor=white)

# Upload Board Project

> 한국어 버전: [README.ko.md](README.ko.md)

A NestJS REST API where authenticated users upload and manage video files.
JWT auth (Passport), PostgreSQL via TypeORM, Multer disk storage, transaction-safe
file promotion, Swagger documentation. A local/portfolio backend project — no
frontend, no deploy pipeline.

- Timeline: 6 weeks (initial build), ongoing refinement
- Skills: TypeORM, PostgreSQL, transactions, DTO validation, Passport, guards, Jest, Swagger

## Documentation

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module map, request flow, entities, conventions |
| [ADR/](ADR/README.md) | Architecture decision records — the *why* behind the design |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [ROADMAP.md](ROADMAP.md) | Decided next steps and known gaps |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow and conventions |
| [CLAUDE.md](CLAUDE.md) | Operating contract for AI-assisted development |

Each document has a Korean sibling (`*.ko.md`).

## Features

- **Authentication** — register/sign-in via HTTP Basic token; dual-secret JWT
  access/refresh pair with a `type` claim ([ADR 0002](ADR/0002-dual-secret-token-pair.md))
- **Two-phase upload** — `temp_` → `granted_` prefix state machine; the DB insert and
  the physical file move commit or roll back together
  ([ADR 0003](ADR/0003-two-phase-upload-contract.md))
- **Ownership checks** — user writes are self-only; file writes are creator-only
  ([ADR 0007](ADR/0007-ownership-checks-without-rbac.md))
- **Boundary validation** — global `ValidationPipe` (`whitelist` +
  `forbidNonWhitelisted`); serialized entities never leak `password`
- **Swagger** — full API documentation and manual test bench at `/doc`

## Quick Start

Prerequisites: Node.js ≥ 18, PostgreSQL ≥ 14, pnpm.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env        # then fill in DB credentials and token secrets

# 3. Ensure the storage folders exist at the repo root:
#      file/temp/    (temporary uploads)
#      file/upload/  (promoted files)

# 4. Create the database schema
#    No migration tooling yet (see ADR 0006): create the database named in
#    DB_DATABASE, then EITHER apply the schema manually, OR temporarily set
#    synchronize: true in src/app.module.ts for the first local boot and flip
#    it back to false. (Transitional guidance — dies with migration adoption.)

# 5. Run the dev server (port 3000)
pnpm run start:dev

# 6. Open Swagger UI
#    http://localhost:3000/doc

# Tests
pnpm test              # unit tests
pnpm run test:cov      # coverage (only services are measured)
```

### Environment variables

Required (Joi-validated at boot — missing vars fail fast): `ENV`, `DB_TYPE`
(`postgres`), `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`,
`HASH_ROUNDS`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`,
`ACCESS_TOKEN_SECRET_EXPIRES_IN`, `REFRESH_TOKEN_SECRET_EXPIRES_IN`.

Optional: `BASE_URL` (default `http://localhost:3000`; composes public file URLs),
`CORS_ORIGIN` (unset = CORS disabled; comma-separated allowlist —
[ADR 0008](ADR/0008-opt-in-cors.md)), `PORT` (default 3000).

## API Endpoints

All endpoints except `/auth/*` require a Bearer access token.

**Authentication**
- `POST /auth/register` — register with a Basic token (`base64(email:password)`)
- `POST /auth/signin` — get `{ refreshToken, accessToken }` (Basic token)
- `POST /auth/signin/local` — same, via body credentials (Passport local strategy)
- `POST /auth/token/refreshaccess` — new access token (Bearer refresh token)

**User** — user creation is `POST /auth/register`; there is no `POST /user`
- `GET /user` — list users
- `GET /user/:id` — get a user
- `PATCH /user/:id` — update a user (self only)
- `DELETE /user/:id` — delete a user (self only)

**File**
- `POST /upload/attach` — upload a video to temp storage (multipart field `video`, 100 MB limit)
- `GET /file` — list files (paginated: `take` 1–100, default 20 / `skip` default 0)
- `GET /file/:id` — get file metadata
- `POST /file/uploadFile` — promote a temp file to permanent storage (transactional)
- `PATCH /file/patch/:id` — update file metadata (creator only)
- `DELETE /file/delete/:id` — delete file metadata (creator only)

### Typical flow

```
POST /auth/register   (Basic)          → user created
POST /auth/signin     (Basic)          → { refreshToken, accessToken }
POST /upload/attach   (Bearer, video)  → { filename: "temp_..." }
POST /file/uploadFile (Bearer, { title, filePath: "temp_..." })
                                       → promoted; served at {BASE_URL}/file/upload/granted_...
```

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

Tracked in [ROADMAP.md](ROADMAP.md). Highlights: no migration tooling yet, no RBAC
(ownership checks only), and the e2e suite is still the untouched Nest template.
Uploads enforce an mp4/mov/webm allowlist and `pnpm lint` is clean as of 2026-07-22.

## Author

BLUECODE77732 — https://github.com/Bluecode77732

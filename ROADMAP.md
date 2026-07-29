# Roadmap

> 한국어 버전: [ROADMAP.ko.md](ROADMAP.ko.md)

The full project plan for the Upload Board Project, established through an
11-axis decision review on 2026-07-23 (essence → methodology → design criteria →
architecture → modules → domain → mechanisms → data handling → platform →
infrastructure → deployment). Amended the same day by the frontend-split
decision ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)),
which inserts Stage F (frontend preparation) ahead of Stage 0. Every item below
lands as its own dedicated, designed change
([CLAUDE.md](CLAUDE.md) > Scope Discipline).

> **Consistency note**: items in this plan that CLAUDE.md marks "never suggest
> unless explicitly requested" (CI, Docker, cloud storage/deployment) entered
> this plan **by explicit decision on 2026-07-23**. Until each dedicated task
> actually lands (with its own ADR), the current Architecture Decisions remain
> operative.

## Current position (as of 2026-07-26)

- The 2026-07-22 hardening run is fully landed: security quick-wins, the
  zero-error lint baseline, the documentation rewrite, and TypeORM migration
  adoption (`79603ad`, [ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md)),
  followed by the Korean fluency pass over the `.ko.md` docs (`dc1ad72`).
- This plan itself was established on 2026-07-23 through the 11-axis review.
- Frontend split decided 2026-07-23, structure amended 2026-07-24
  ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)): the frontend
  lives as a `frontend/` subfolder in this same repository (backend stays at the
  root, untouched) and consumes this API over HTTP; admin starts as an `/admin`
  route section inside it. RBAC is re-sequenced after Stage F — it adds
  permissions without changing the API surface, so deferring it costs the
  frontend no rework, while freezing the surface first saves it real rework.
- Route cleanup & contract freeze landed 2026-07-23: `POST /file`,
  `PATCH /file/:id`, `DELETE /file/:id`, `POST /auth/token/refresh` are the
  canonical routes; the API surface is now frozen (ADR 0010).
- The error-code contract landed 2026-07-23
  ([ADR 0011](ADR/0011-error-code-contract.md)): every error response carries a
  stable machine-readable `code`, shaped by the global exception filter.
- The refresh-token httpOnly-cookie move + rotation/reuse detection landed
  2026-07-24 ([ADR 0012](ADR/0012-refresh-cookie-rotation.md)) — **Stage F is
  complete**: the API surface, error contract, and auth transport a frontend
  depends on are all settled. The `frontend/` subfolder was created 2026-07-24
  (React + Vite, auth vertical slice E2E-verified); RBAC proceeds in parallel
  (it changes no API surface).
- RBAC + audit log landed 2026-07-25 ([ADR 0013](ADR/0013-rbac-and-audit-log.md))
  — **Stage 0 is complete**: `user`/`admin`/`superadmin` roles, RolesGuard,
  ownership extended to "self or admin", superadmin-only role assignment, and an
  append-only audit trail. The role system backs the frontend `/admin` section.
- **Stage 1 Foundation is complete** (2026-07-25): Node/pnpm pinning, Docker/compose,
  CI, logging conventions, and the E2E rewrite all landed (ADR 0014–0017).
- **Stage 2 is under way**: orphan temp-file cleanup landed 2026-07-26
  ([ADR 0018](ADR/0018-orphan-temp-file-cleanup.md)) — a scheduled `@nestjs/schedule`
  sweep in a new operational `TempCleanupModule` — and the upload duplicate-submission
  policy landed 2026-07-27 ([ADR 0019](ADR/0019-upload-claim-idempotency.md)): the
  attach-issued filename is a one-shot claim token, so a retry replays (200) instead of
  erroring. **Next Stage 2 task**: deletion policy design (soft delete + the
  `DELETE /user/:id` FK-constraint 500).

## 1. Vision & essence

- **Today**: a portfolio/learning backend — the point is demonstrable
  engineering discipline (design, documentation, tests) on a small but complete
  API.
- **Target**: a production-oriented backend with a browser frontend as its
  decided consumer (in-repo `frontend/` subfolder, [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)).
  The later stages (foundation infrastructure, AWS deployment, playback access
  control) exist to make that transition real rather than aspirational.
- **Priority axis** (supersedes the previous "security → decided architecture
  work → hygiene → docs/tests"): security → frontend preparation (API surface
  freeze) → decided architecture work (RBAC) → foundation (reproducibility ·
  observability · test reliability) → mechanism hardening → domain expansion →
  production transition.

## 2. Methodology

- **Dedicated task units.** Every roadmap item is an independent task with its
  own design, review, and documentation — the roadmap-level restatement of
  [CLAUDE.md](CLAUDE.md) > Scope Discipline. No bundling, no drive-by scope.
- The stages in section 6 are **dependency groupings, not milestones**: work
  proceeds item by item, and crossing a stage boundary carries no ceremony.

## 3. Design criteria

**Frozen (unchanged)** — the three existing axes, Never Do Groups 1–3 in
[CLAUDE.md](CLAUDE.md): runtime safety, data integrity, security. All roadmap
work must pass them; they are not themselves roadmap subjects.

**Adopted 2026-07-23** — five new axes that govern this plan:

| Axis | Rationale |
|---|---|
| Observability | Logging infrastructure is currently zero. A backend that cannot be diagnosed cannot be operated — the first prerequisite of the production target. |
| Reproducibility / portability | Node/pnpm versions unpinned, DB provisioned by hand. Environment drift becomes a direct failure source the moment a deploy target exists. |
| API contract stability | The consumer is now decided (frontend, 2026-07-23) — Stage F is this axis activating: routes canonicalized and frozen while zero consumers exist, error codes delivered as Stage F work. URI versioning stays deferred until a post-freeze breaking change actually needs it. |
| Test reliability | The e2e suite is the untouched Nest template; unit tests alone cannot guarantee the auth flow or the `temp_` → `granted_` path end to end. |
| Performance / capacity | Board-domain expansion raises list-query complexity, and video serving is disk/bandwidth-heavy. Response-time targets, index policy, and disk ceilings become explicit criteria. |

**Advisory (recorded, not governing)**:

- Privacy / compliance — the PII log ban is already mandatory (Never Do G3);
  deletion policy connects to the Stage 2 deletion-design task.
- Release / change management — semver tagging + migration-ordering
  conventions; activates with deployment.
- Docs-as-code enforcement — machine-checked README/endpoint consistency; a
  candidate under the CI task.

## 4. Architecture direction

- **Now**: the layered modular monolith stays — Controller → Service →
  Repository, four single-responsibility modules. No pattern change is in
  roadmap scope.
- **Future goal (decided 2026-07-23)**: a **storage port-adapter** — a
  `FileStorage` interface isolating physical-file operations so the local-disk
  implementation ([ADR 0005](ADR/0005-local-disk-storage.md)) can be swapped
  for cloud storage (S3) when Stage 4 makes it necessary. Landing it requires
  revisiting ADR 0005 and passing the ISP rule ("no service-interface layer
  until a real second implementation exists") through the Principle Conflict
  Protocol.
- **Frontend split (decided 2026-07-23, structure amended 2026-07-24, [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md))**:
  the frontend lives as a `frontend/` subfolder in this same repository (backend
  at the root, untouched) and consumes this API over HTTP; admin starts as an
  `/admin` route section inside that frontend and is promoted to its own app
  only after RBAC lands and real admin requirements exist. A pnpm-workspace
  monorepo (relocating the backend into `apps/backend`) and an immediate
  three-way split (frontend/backend/admin) were considered and rejected.
- **Known constraint (accepted)**: static file serving stays unauthenticated
  until the Stage 4 VOD playback access-control task revisits
  [ADR 0005](ADR/0005-local-disk-storage.md) — `{BASE_URL}/file/...` URLs are
  public, and the frontend must treat them as such.
- Considered and set aside in the review: event-driven reinforcement (only one
  side effect exists to decouple, and moving the rename out of the transaction
  would break `temp_`/`granted_` atomicity) and CQRS-lite (the read model is
  too simple to split; YAGNI).
- **Module policy**: four modules, planned work absorbed into existing ones
  (RBAC → auth/user). New modules only when a new domain arrives — the board
  expansion (Stage 3) is that sanctioned case.

## 5. Domain plan

- **Today**: authenticated video-file upload/management only. The "board" in
  the project name is unimplemented.
- **Decided**: expand into an actual upload board — a post/comment domain whose
  posts reference uploaded files. Entity relations (post ↔ `FileEntity`,
  comment ↔ post/user) will be described in plain text first and land as
  reviewed migrations, per [CLAUDE.md](CLAUDE.md) > Scope Discipline (schema
  changes).
- List search/filter/sort (Stage 3) is the data-layer prerequisite for board
  listings.

## 6. Staged task list

Ordering is by dependency. Each row is one dedicated task.

### Stage F — Frontend preparation (decided 2026-07-23, [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md))

The pre-frontend backend pipeline — everything a browser client will depend on,
settled while zero consumers exist.

| Task | Rationale / dependencies |
|---|---|
| Route cleanup & API contract freeze | Canonicalize `POST /file`, `PATCH /file/:id`, `DELETE /file/:id`, `POST /auth/token/refresh`; freeze the surface while breaking changes are still free (plural rename and auth action-route changes considered and rejected — ADR 0010). |
| Error-code system (global exception filter) | A machine-readable error contract before the frontend hardcodes message strings or status-only branching. |
| Refresh-token httpOnly-cookie move + rotation / reuse detection | **Pulled forward from Stage 2 (2026-07-23)** — a browser frontend makes token storage a real XSS surface. Requires its own ADR amending [ADR 0002](ADR/0002-dual-secret-token-pair.md)'s "no server-side token storage" stance, plus a reviewed schema migration. |

### Stage 0 — decided architecture work (RBAC) — ✅ complete 2026-07-25

| Task | Rationale / dependencies |
|---|---|
| ~~**RBAC** — `role` column + role-aware guard~~ | **Landed 2026-07-25** ([ADR 0013](ADR/0013-rbac-and-audit-log.md)): three tiers (`user`/`admin`/`superadmin`), `PATCH /user/:id/role` superadmin-only, ownership extended to "self **or** admin", plus an audit log. Shipped as a reviewed migration. |

### Stage 1 — Foundation (reproducibility · observability · test reliability) — ✅ complete 2026-07-25

| Task | Rationale / dependencies |
|---|---|
| ~~Pin Node/pnpm (`engines` + `.nvmrc`)~~ | **Landed 2026-07-25** ([ADR 0014](ADR/0014-node-pnpm-version-pinning.md)): `.nvmrc` `24.8.0`, `engines` floor (`node >=24`, `pnpm >=10`, advisory), `packageManager` `pnpm@10.14.0`. The single source the Docker base-image tag and CI toolchain now derive from. |
| ~~Docker / docker-compose (app + local PostgreSQL)~~ | **Landed 2026-07-25** ([ADR 0015](ADR/0015-docker-and-compose.md)): multi-stage `Dockerfile` (build `node:24.8.0` → `slim` runtime, migrations-on-boot) + `docker-compose.yml` (`db` postgres:16 + `api`). Supersedes the manual `upload-board-pg`; removes the e2e's manual-DB dependency. Precondition of the AWS stage met. |
| ~~CI — GitHub Actions (lint + test)~~ | **Landed 2026-07-25** ([ADR 0016](ADR/0016-github-actions-ci.md)): `.github/workflows/ci.yml` on push/PR to main/dev — a `lint-and-unit` job (`lint:ci` without `--fix` + unit tests) and an `e2e` job against a `postgres:16` service. Toolchain from the ADR 0014 pin (Corepack + `.nvmrc`). The 0-error baseline is now machine-checked. |
| ~~Logging conventions (Nest Logger first)~~ | **Landed 2026-07-25** ([ADR 0017](ADR/0017-logging-conventions.md)): Nest's built-in `Logger` in `AllExceptionsFilter` — 5xx at `error` with the withheld stack, 4xx at `debug`; level convention + no-PII rule documented. Structured/JSON output and external error tracking (Sentry) deferred to Stage 4. |
| ~~E2E rewrite~~ | **Landed 2026-07-25**: 18-case suite (`test/app.e2e-spec.ts` + a new `test/e2e-utils.ts` harness) over real HTTP+DB — auth flow, refresh rotation/reuse, ownership 403s, pagination, `temp_` → `granted_` promotion. Isolation: a throwaway `upload_board_e2e` DB built by the real migrations and truncated per test. Still needs the manual local Postgres (5435) until the Docker-compose task removes that dependency. |

### Stage 2 — Mechanism hardening

| Task | Rationale / dependencies |
|---|---|
| ~~Orphan temp-file cleanup~~ — ✅ landed 2026-07-26 ([ADR 0018](ADR/0018-orphan-temp-file-cleanup.md)) | `temp_` files accumulated forever when `POST /file` was never called — the only unmanaged resource leak. A scheduled `@nestjs/schedule` sweep (new `TempCleanupModule`) deletes `temp_` files in `file/temp` past a TTL (default 24h, hourly). |
| Deletion policy design (soft delete + FK) | One design task uniting the soft-delete question with the `DELETE /user/:id` FK-constraint 500 (`FileEntity.creator` is `nullable: false`). |
| ~~Upload idempotency / duplicate policy~~ — ✅ landed 2026-07-27 ([ADR 0019](ADR/0019-upload-claim-idempotency.md)) | The attach-issued `temp_{uuid}_{ts}` filename is a one-shot claim token: resubmitting it replays the existing file (200) for its claimant, conflicts (409 `FILE_ALREADY_CLAIMED`) for anyone else, and a concurrent double-submit resolves through the unique constraint instead of a 500. `filePath` is pinned to the issued shape at the DTO boundary, which also closes a path-traversal gap. No schema change. |

### Stage 3 — Domain expansion

| Task | Rationale / dependencies |
|---|---|
| List search / filter / sort | Prerequisite for board listings; `GET /file` is QueryBuilder-based, so the extension path exists. |
| Board domain — post/comment modules | New domain modules (sanctioned by module policy); plain-text schema description first, then reviewed migrations; RBAC, ownership, and pagination patterns apply from day one. |

### Stage 4 — Production transition

| Task | Rationale / dependencies |
|---|---|
| AWS container deployment | Local: Docker (compose); deploy: AWS, container-based. New deployment ADR; depends on Stage 1 Docker + CI. |
| Container & deploy hardening | Surfaced by [ADR 0015](ADR/0015-docker-and-compose.md): the Stage 1 image is deploy-*capable* but not production-grade. Non-root `USER` (runs as root today), a distroless runtime base (drop the shell/apt attack surface), a health/readiness endpoint (for LB/orchestrator probes), migrations as a **separate deploy step** rather than on container boot (avoids multi-instance migration races), secrets via a manager instead of `.env`/`env_file`, HTTPS termination (the `Secure` refresh cookie requires it when `ENV=prod`), and a target-arch build (x64 prebuilt `bcrypt` today; ARM/Graviton needs a matching prebuild or `pnpm.onlyBuiltDependencies`). Depends on the AWS deployment task. |
| VOD playback access control | Uploaded files are currently public URLs — anyone with the link can watch. An authenticated playback path; includes revisiting ADR 0005's static-serving decision. (Playback of uploaded files, not live streaming.) |
| Storage port-adapter | Only if/when the S3 need is confirmed — see Architecture direction (section 4). |
| Performance / capacity criteria | Index policy, response-time targets, disk ceilings — measured before optimized. |

## 7. Unscheduled / open decisions

- Testcontainers for e2e (recorded 2026-07-26): the e2e suite uses a throwaway DB
  plus a jest `setupFiles` env override ([ADR 0016](ADR/0016-github-actions-ci.md),
  `test/e2e-env.ts`) — valid, but it relies on env-before-import timing and a
  pre-provisioned Postgres. Testcontainers (an ephemeral per-run container injected via
  a Nest provider override) would remove both. Deferred: a new dev dependency plus a CI
  change; revisit when the deploy environment (Stage 4) is set.
- License: `package.json` says `UNLICENSED`; the pre-rewrite README claimed
  MIT — decide before the repo is published.
- Chat-project remnant handling ([plan](CHAT-REMNANT-REMOVAL-PLAN.md)):
  git-history decision + re-verification trigger for new or pasted-in docs.
- Dev-transitive `pnpm audit` findings (handlebars via ts-jest;
  glob/minimatch/webpack via jest and @nestjs/cli) — build/test-time only;
  waiting on upstream releases. (`pnpm audit --prod` is clean as of 2026-07-24.)
- API versioning timing — the consumer is now decided; versioning activates
  when a post-freeze breaking change actually needs it (see Design criteria).
- Frontend stack — **decided 2026-07-24: React + Vite** (SPA consuming this
  REST API; Next.js rejected as SSR/API-route overlap with this backend, Vue as
  runner-up). Lives as the in-repo `frontend/` subfolder (ADR 0010, structure
  amended 2026-07-24); created and E2E-verified 2026-07-24; hosting is a
  later deployment decision.
- Canonical signin path — **decided 2026-07-24: `POST /auth/signin` (Basic)**,
  chosen for lowest risk / lightest maintenance (reuses `parseBasicToken` that
  `register` needs anyway; RFC 7617 protocol standard; backed by ADR 0001).
  `POST /auth/signin/local` (+ `LocalStrategy` + `LocalAuthGuard`) is therefore
  a **removal candidate** — retiring it is its own dedicated task under Scope
  Discipline, not a drive-by; it stays until then.
- Doc-wording sync (deferred 2026-07-23; completed 2026-07-29): pre-plan
  "candidate" phrasings reconciled with this plan. ADR 0003 ("candidate
  roadmap item") now points at the landed [ADR 0018](ADR/0018-orphan-temp-file-cleanup.md);
  ADR 0006 Consequences ("top roadmap item") carries a dated landed note; and
  `CHAT-REMNANT-REMOVAL-PLAN` ("ROADMAP's CI candidate") now points at the landed
  Stage 1 CI ([ADR 0016](ADR/0016-github-actions-ci.md)). **Done.**

## 8. Advisory notes

Recorded criteria that inform but do not schedule work: privacy/compliance
(deletion policy, retention), release/change management (semver + migration
ordering), docs-as-code enforcement (automated README/endpoint consistency — a
candidate under the CI task).

## 9. Completed

### 2026-07-27

| Item | Notes |
|---|---|
| Upload duplicate-submission policy | The attach-issued filename is a one-shot claim token: a resubmit replays the existing file (200) for its claimant, 409 `FILE_ALREADY_CLAIMED` for anyone else, 400 `FILE_INVALID_PATH` when no temp file backs it, and a concurrent double-submit is resolved by the unique constraint instead of a 500. `filePath` pinned to the issued shape on `UploadFileDto` (closes a path-traversal gap); no schema change — **second Stage 2 task** ([ADR 0019](ADR/0019-upload-claim-idempotency.md)) |

### 2026-07-26

| Item | Notes |
|---|---|
| Orphan temp-file cleanup | Scheduled `@nestjs/schedule` sweep in a new operational `TempCleanupModule` deletes `temp_` files left in `file/temp` past a TTL (`TEMP_SWEEP_TTL_HOURS`, default 24h; hourly cron); `granted_`/`file/upload` never touched, dry-run + enable toggles, `cron` promoted to a direct dep — **first Stage 2 task** ([ADR 0018](ADR/0018-orphan-temp-file-cleanup.md)) |

### 2026-07-25

| Item | Notes |
|---|---|
| RBAC + audit log | `user`/`admin`/`superadmin` roles, RolesGuard/@Roles, ownership "self or admin", superadmin-only `PATCH /user/:id/role` (last-superadmin guard + session invalidation), append-only audit log with `GET /audit-log`, `SUPERADMIN_EMAIL` seed — **Stage 0 complete** ([ADR 0013](ADR/0013-rbac-and-audit-log.md)) |

### 2026-07-23

| Item | Notes |
|---|---|
| Full roadmap plan established | 11-axis decision review; this document is its record |
| Frontend split decision + Stage F pipeline | In-repo `frontend/` subfolder (structure amended 2026-07-24), admin as `/admin` route, contract freeze; RBAC re-sequenced after Stage F ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)) |
| Route cleanup & API contract freeze | `POST /file`, `PATCH /file/:id`, `DELETE /file/:id`, `POST /auth/token/refresh` — surface frozen with zero consumers (Stage F task 1) |
| Error-code contract | Frozen `ErrorBody` shape + 18-code catalog + global `AllExceptionsFilter` via `APP_FILTER` (Stage F task 2, [ADR 0011](ADR/0011-error-code-contract.md)) |

### 2026-07-24

| Item | Notes |
|---|---|
| Refresh-token httpOnly cookie + rotation/reuse detection | `refreshTokenHash` anchor column, `SameSite=Strict` cookie, `POST /auth/signout`; Stage F task 3 — **Stage F complete** ([ADR 0012](ADR/0012-refresh-cookie-rotation.md)) |

### 2026-07-22

| Item | Notes |
|---|---|
| Ownership checks | User writes self-only; file writes creator-only (`0549ca4`) |
| `GET /file` pagination | `GetFilesDto`: `take` 1–100 (default 20), `skip` (default 0) |
| `getFiles` creator join | List responses now include `creator`, matching `GET /file/:id` |
| Opt-in CORS | `CORS_ORIGIN` env var; unset = disabled |
| Upload type allowlist | mp4/mov/webm mimetype + extension filter on `POST /upload/attach` |
| Runtime CVE pins | `jws ^3.2.3`, `validator ^13.15.22` via `pnpm.overrides` |
| Lint restored & clean | `typescript-eslint` added; 45 pre-existing errors fixed; 0 errors baseline |
| Doc sync | README endpoints/limitations, CLAUDE.md gaps, `.env.example` (`BASE_URL`, `CORS_ORIGIN`) |
| `@nestjs/jwt` to `dependencies` | Was in devDependencies despite runtime use — `--prod` installs no longer break |
| `saved!`/`updated!` removed | `FileService` post-commit re-reads moved outside the `try` with a null guard |
| TypeORM migration adoption | `migration:*` scripts, `backend/data-source.ts`, baseline `InitialSchema`; pre-existing DBs: `pnpm migration:run -- --fake` once ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md)) |

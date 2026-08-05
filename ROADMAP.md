# Roadmap

> 한국어 버전: [ROADMAP.ko.md](ROADMAP.ko.md)

The full project plan for the Upload Board Project, established through an
11-axis decision review on 2026-07-23 (essence → methodology → design criteria →
architecture → modules → domain → mechanisms → data handling → platform →
infrastructure → deployment). Amended the same day by the frontend-split
decision ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)),
which inserts Stage F (frontend preparation) ahead of Stage 0. Amended again on
2026-07-30 by [ADR 0022](ADR/0022-admin-console-import-from-chat-project.md),
which **appends Stage 5 (operational surface — admin console)**: the 11-axis review
scheduled no stage for the admin surface, even though ADR 0010 had decided its
placement, so the work existed as a decision with no home in the plan. Amended once
more on 2026-07-31 by [ADR 0025](ADR/0025-file-visibility-and-media-expansion.md),
which **generalizes the Stage 4 "VOD playback access control" row** into file
visibility (public/private/unlisted), access-controlled serving of all media, and a
media-type expansion — a gap surfaced by restating the project's founding goals. Every
item below lands as its own dedicated, designed change
([CLAUDE.md](CLAUDE.md) > Scope Discipline).

> **Consistency note**: items in this plan that CLAUDE.md marks "never suggest
> unless explicitly requested" (CI, Docker, cloud storage/deployment) entered
> this plan **by explicit decision on 2026-07-23**. Until each dedicated task
> actually lands (with its own ADR), the current Architecture Decisions remain
> operative.

## Current position (as of 2026-07-31)

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
  erroring. The deletion policy landed 2026-07-30
  ([ADR 0020](ADR/0020-account-deletion-cascade.md)): soft delete is not adopted, an
  account cascades into its files only on an explicit `deleteFiles=true`, and the old
  FK-violation 500 is now a typed 409 — **Stage 2 is complete**.
- **Stage 3 is complete (2026-07-31)**: list search / filter / sort landed 2026-07-30
  ([ADR 0021](ADR/0021-list-query-search-filter-sort.md)) — `GET /file` now takes
  `search`, `creatorId`, `sortBy`, and `order`, with sort keys resolved through an in-code
  whitelist and a deterministic default order the endpoint previously lacked. The board
  domain's **schema design gate** followed on 2026-07-30
  ([ADR 0023](ADR/0023-board-domain-schema.md)) — post and comment settled together in
  plain text, with no code — and its two implementation halves landed on 2026-07-31: the
  post module first (comment depends on post, not the reverse), then the comment module,
  with [ADR 0024](ADR/0024-account-cascade-fk-refusal.md) settling the post↔file invariant
  gap in between. **The board this project is named for now exists**: posts with an optional
  attached video, and threads under them.
- **Stage 5 (operational surface — admin console) was appended 2026-07-30**
  ([ADR 0022](ADR/0022-admin-console-import-from-chat-project.md)), closing a gap in the
  original plan: ADR 0010 decided where admin lives back on 2026-07-23, but no stage ever
  owned building it. The Chat Project's admin console was imported to `admin/` as an
  unadapted modification base in the same change. Nothing in Stage 5 has started, and its
  first row — how a client learns its own role — is a backend decision that blocks the rest.
  It does **not** depend on Stage 4 and may run before it.
- **Execution order for the remaining work fixed 2026-07-31** (see section 6 >
  Execution order): ~~#1 board comment module~~ (✅ done 2026-07-31) → ~~#2 `GET /user`
  pagination~~ (✅ done 2026-08-05, pulled forward from Stage 5) → **#3 Stage 5 admin
  surface — in progress** (its blocking first row, role delivery, done 2026-08-05 via
  [ADR 0028](ADR/0028-access-token-role-claim.md); console adaptation is next) → #4 Stage 4
  deployment, last. This resolves Stage 5's floating position (before Stage 4) and pulls the
  independent pagination debt ahead of both.
- **File visibility + media-type expansion decided 2026-07-31** (design gate,
  [ADR 0025](ADR/0025-file-visibility-and-media-expansion.md)): restating the project's
  founding goals surfaced two gaps — every stored file is served publicly with no
  private/unlisted option, and the upload allowlist is video-only. The decision adds a
  3-state `visibility` (public/private/**unlisted** via a rotatable share token, optional
  TTL), an access-controlled `GET /file/:id/content` endpoint (so `ServeStaticModule` stops
  exposing `file/upload`), and images+audio+video type-specific upload fields. It
  **generalizes and replaces the Stage 4 "VOD playback access control" row** and, being
  independent of the deploy target, may be sequenced ahead of deployment.
- ~~**Visibility + access-controlled serving implemented 2026-08-01**~~ ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.md)
  D1/D2/D3/D6 + [ADR 0026](ADR/0026-file-visibility-implementation.md)): the migration
  landed (reviewed line-by-line), `GET /file/:id/content` is live with Range support, and
  `GET /file`/`GET /file/:id` filter private/unlisted metadata from non-owners.
- ~~**Media-type expansion implemented 2026-08-01**~~ ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.md)
  D4/D5 + [ADR 0027](ADR/0027-media-type-expansion-implementation.md)): `POST /upload/attach`
  now accepts `image`/`audio`/`video` as three type-specific fields, each with its own class
  allowlist, replacing the single `video` field. No schema change. ~~Frontend adoption of
  both the new `fileUrl`/`visibility` response shape and the split upload fields~~ — ✅
  **done 2026-08-03** (Unscheduled below).

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
- ~~**Known constraint**: static file serving is unauthenticated~~ — **resolved on the
  backend 2026-08-01** ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.md) D1/D2/D3/D6
  + [ADR 0026](ADR/0026-file-visibility-implementation.md)): `ServeStaticModule` no longer
  exposes `file/upload`, and access is enforced by `GET /file/:id/content`
  (public/private/unlisted, Range-aware). The frontend adopted this 2026-08-03 (see
  Unscheduled) — it now reads `fileUrl` as the content endpoint and can toggle visibility.
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
  comment ↔ post/user) were described in plain text first, per
  [CLAUDE.md](CLAUDE.md) > Scope Discipline (schema changes), and land as
  reviewed migrations in the follow-up implementation task.
- **Schema settled 2026-07-30** ([ADR 0023](ADR/0023-board-domain-schema.md)) —
  the design gate ahead of that implementation, with no code: a post references
  at most one file (unique, nullable FK) that its own creator uploaded, which is
  also its idempotency key; comments are flat (no threading) and die with their
  post through the schema's one and only `ON DELETE CASCADE`; deleting a file a
  post references is refused with 409 `FILE_IN_USE` via the FK rather than a
  pre-check; the account cascade ([ADR 0020](ADR/0020-account-deletion-cascade.md))
  absorbs posts and comments while `deleteFiles=true` keeps confirming files
  only; ownership stays "creator or admin" with no new authorization axis.
- List search/filter/sort (Stage 3) is the data-layer prerequisite for board
  listings — landed 2026-07-30 ([ADR 0021](ADR/0021-list-query-search-filter-sort.md)),
  so the post listing extends that read layer rather than defining its own.

## 6. Staged task list

Ordering is by dependency. Each row is one dedicated task.

### Execution order for remaining work (decided 2026-07-31)

The stages below are grouped by dependency, but several ready items span stages,
so the actual build sequence is fixed here (completed stages omitted). Each pending
item carries its execution number in its own row.

1. ~~**Board domain — comment module** (Stage 3)~~ — ✅ done 2026-07-31, **completing
   Stage 3**. Its gate, the post↔file invariant gap, was settled first by
   [ADR 0024](ADR/0024-account-cascade-fk-refusal.md), which left the account-cascade
   delete order untouched, so the comment delete slotted in ahead of posts without
   rewriting it. **Execution #2 is now the next dedicated task.**
2. ~~**`GET /user` pagination**~~ (pulled forward from Stage 5) — ✅ done 2026-08-05.
   New `GetUsersDto` (`take` 1–100 default 20, `skip` ≥0 default 0) mirrors `GetFilesDto`;
   `UserService.findAll` sorts `createdAt DESC, id DESC` for deterministic pages; response
   stays the existing `[rows, total]` tuple (`GET /file` shape, no new ADR). Search/sort
   were deliberately left out of scope — the ROADMAP item named pagination only — and
   remain open for Stage 5 if the admin console needs them. **Execution #3 is now next.**
3. **Stage 5 — operational surface (admin console)**, sequenced **before Stage 4**:
   ~~role-delivery decision (blocked the rest)~~ (✅ done 2026-08-05,
   [ADR 0028](ADR/0028-access-token-role-claim.md) — access token gains a `role` claim) →
   **adapt the imported console — now next** → moderation-existence decision → resolve the
   duplicate admin surface. Rationale (already recorded in the Stage 5 note): a deployed
   system whose privilege hierarchy is operable only through Swagger is hard to run, so the
   operational surface precedes deployment.
4. **Stage 4 — production transition (deployment)**, sequenced **last**: AWS
   deployment → container/deploy hardening → VOD access control → storage
   port-adapter (conditional) → performance/capacity criteria.

This resolves Stage 5's "numbering is not dependency order" note in favor of Stage 5
before Stage 4, and pulls the one independent debt item (#2) ahead of both. Within a
stage, the internal dependency order in its table still holds.

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
| ~~Deletion policy design (soft delete + FK)~~ — ✅ landed 2026-07-30 ([ADR 0020](ADR/0020-account-deletion-cascade.md)) | Soft delete **not** adopted; deletion stays hard. `DELETE /user/:id?deleteFiles=true` cascades into the account's file rows and stored files, while an unconfirmed request against an account that owns files is refused with 409 `USER_HAS_FILES` (count in the message) instead of the old FK-violation 500. `DELETE /file/:id` now also unlinks the stored `granted_` file — a leak found during this task. Unlink runs post-commit (irreversible step last); no schema change. |
| ~~Upload idempotency / duplicate policy~~ — ✅ landed 2026-07-27 ([ADR 0019](ADR/0019-upload-claim-idempotency.md)) | The attach-issued `temp_{uuid}_{ts}` filename is a one-shot claim token: resubmitting it replays the existing file (200) for its claimant, conflicts (409 `FILE_ALREADY_CLAIMED`) for anyone else, and a concurrent double-submit resolves through the unique constraint instead of a 500. `filePath` is pinned to the issued shape at the DTO boundary, which also closes a path-traversal gap. No schema change. |

### Stage 3 — Domain expansion

| Task | Rationale / dependencies |
|---|---|
| ~~List search / filter / sort~~ — ✅ landed 2026-07-30 ([ADR 0021](ADR/0021-list-query-search-filter-sort.md)) | `GET /file` gained `search` (escaped `ILIKE '%term%'` on the title), `creatorId`, and `sortBy`/`order` resolved through a total-`Record` whitelist — plus the `ORDER BY` the endpoint never had, so offset paging is deterministic. No schema change; the three candidate indexes are deferred with their triggers recorded. This is the read-layer pattern the post listing extends. |
| ~~Board domain — schema design gate~~ — ✅ landed 2026-07-30 ([ADR 0023](ADR/0023-board-domain-schema.md)) | The plain-text schema description Scope Discipline requires before any migration, covering both entities at once so the comment task cannot force a post-schema rollback: post ↔ file is 1:1, optional, same-creator (the unique FK doubles as `POST /post`'s idempotency key); comments are flat and cascade with their post at the FK; `DELETE /file/:id` on an attached file becomes 409 `FILE_IN_USE`; the ADR 0020 account cascade takes posts and comments unconfirmed while the flag still guards files only; `canManage` and the ADR 0021 read layer are reused unchanged. Design only — no code, no migration. |
| ~~Board domain — post module~~ — ✅ landed 2026-07-31 ([ADR 0023](ADR/0023-board-domain-schema.md) > Implementation notes) | The first half of ADR 0023, split out because comment depends on post and not the reverse: `PostModule` (5 routes behind `JwtAuthGuard`), `post_entity` with 2 FKs and `UQ_post_entity_fileId` (reviewed migration — generate's four spurious constraint-rename statements stripped), 3 new error codes, the `DELETE /file/:id` `23503` → 409 `FILE_IN_USE` translation, and posts joining the ADR 0020 account cascade (`posts=N` in the audit detail). The ADR 0021 read layer and `canManage` were reused rather than restated. |
| ~~Board domain — comment module~~ — ✅ landed 2026-07-31 ([ADR 0023](ADR/0023-board-domain-schema.md) > Implementation notes) | The second half of ADR 0023, and with it **Stage 3 is complete**. `CommentModule` ships the ADR's four routes behind `JwtAuthGuard` across two controllers (a thread hangs off its post, an existing comment is addressed by its own id), over a `comment_entity` carrying the schema's only `ON DELETE CASCADE` FK plus `IDX_comment_entity_postId_createdAt` (reviewed migration — generate's six spurious constraint-rename statements stripped). `COMMENT_NOT_FOUND` and the `COMMENT_DELETE` audit action arrived with their consumers. Comments join the account cascade **ahead of posts**, because the account's comments on *other people's* posts are unreachable through the post FK cascade. Two design decisions were kept rather than softened: no `comments=N` in the audit detail (the cascaded half is uncountable, so a partial count would read as a total), and no idempotency key (a repeat creates a second comment, as for a post with no `fileId`). Its gate was cleared first by [ADR 0024](ADR/0024-account-cascade-fk-refusal.md). |

### Stage 4 — Production transition — sequenced **last** in the execution order (2026-07-31)

Deployment comes after the board domain, the pagination debt, and the Stage 5 admin surface
(see Execution order above). The rows below keep their internal dependency order.

| Task | Rationale / dependencies |
|---|---|
| AWS container deployment | Local: Docker (compose); deploy: AWS, container-based. New deployment ADR; depends on Stage 1 Docker + CI. |
| Container & deploy hardening | Surfaced by [ADR 0015](ADR/0015-docker-and-compose.md): the Stage 1 image is deploy-*capable* but not production-grade. Non-root `USER` (runs as root today), a distroless runtime base (drop the shell/apt attack surface), a health/readiness endpoint (for LB/orchestrator probes), migrations as a **separate deploy step** rather than on container boot (avoids multi-instance migration races), secrets via a manager instead of `.env`/`env_file`, HTTPS termination (the `Secure` refresh cookie requires it when `ENV=prod`), and a target-arch build (x64 prebuilt `bcrypt` today; ARM/Graviton needs a matching prebuild or `pnpm.onlyBuiltDependencies`). Depends on the AWS deployment task. |
| ~~File visibility & access-controlled serving~~ **(landed 2026-08-01, [ADR 0025](ADR/0025-file-visibility-and-media-expansion.md) D1/D2/D3/D6 + [ADR 0026](ADR/0026-file-visibility-implementation.md); generalizes the former "VOD playback access control" row)** | Uploaded files used to be plain public URLs — anyone with the link could watch. `FileEntity` now carries a 3-state `visibility` (public/private/**unlisted** via a rotatable share token + optional TTL); `GET /file/:id/content` is the sole access-controlled read path (Range-aware), and `ServeStaticModule` no longer exposes `file/upload`. Partially revises [ADR 0005](ADR/0005-local-disk-storage.md) (serving). **Frontend adoption of the new `fileUrl`/`visibility` shape is still outstanding** — see Unscheduled below. |
| ~~Media-type expansion (images/audio, type-specific upload fields)~~ **(landed 2026-08-01, [ADR 0025](ADR/0025-file-visibility-and-media-expansion.md) D4/D5 + [ADR 0027](ADR/0027-media-type-expansion-implementation.md) — split from the row above 2026-08-01)** | `POST /upload/attach` now accepts `image` (jpg/jpeg/png/webp), `audio` (mp3), or `video` (mp4/mov/webm, unchanged) as three type-specific fields, each with its own allowlist, replacing the single `video` field. Revises [ADR 0003](ADR/0003-two-phase-upload-contract.md)/[ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md) (upload field, a breaking change against the live frontend). No schema change. **Frontend adoption of the new upload fields is still outstanding** — see Unscheduled below. |
| Storage port-adapter | Only if/when the S3 need is confirmed — see Architecture direction (section 4). |
| Performance / capacity criteria | Index policy, response-time targets, disk ceilings — measured before optimized. |

### Stage 5 — Operational surface (admin console) — added 2026-07-30

**Why a new stage rather than a row in an existing one.** An admin console is neither board
domain (Stage 3) nor infrastructure (Stage 4), and until now **no stage owned it at all** —
[ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md) decided admin's *placement* in
2026-07-23 but never scheduled the work, so it sat outside the plan while every other decided
item had a row. Adding the stage closes that gap; the import that prompted it is
[ADR 0022](ADR/0022-admin-console-import-from-chat-project.md).

**Numbering is not dependency order here** — the one exception to this section's rule. Stage 5
does **not** depend on Stage 4: its only hard prerequisite is Stage 0 (RBAC, complete
2026-07-25) plus the role-delivery decision in the first row below. It can run before, after, or
alongside Stage 4. It is numbered last because it was added last, not because it must come last.
There is a soft argument for pulling it *ahead* of Stage 4: a deployed system whose privilege
hierarchy can only be operated through Swagger is hard to run in production.

**Resolved 2026-07-31 — Stage 5 runs before Stage 4** (see Execution order above). The soft
argument won: the operational surface precedes deployment. Stage 5's internal order is
role-delivery → adapt console → moderation decision → resolve duplicate surface; its
`GET /user` pagination row was pulled out to execution #2 as an early quick win — **done
2026-08-05**, see the row below. The role-delivery row itself is also **done, 2026-08-05**
([ADR 0028](ADR/0028-access-token-role-claim.md)) — console adaptation is next.

| Task | Rationale / dependencies |
|---|---|
| ~~**How the client learns a user's role**~~ (backend decision — **done 2026-08-05**, [ADR 0028](ADR/0028-access-token-role-claim.md)) | Chose the access-token `role` claim over a request-based lookup (`GET /user/:id` or a new `GET /auth/me`): matches the frontend's existing client-side JWT-decode pattern (no new round trip), and the one real cost — a demoted user's *decoded* role can lag up to the access-token TTL — never becomes a live privilege, since `RolesGuard`/`AuthUser` still source `role` from `JwtStrategy.validate`'s per-request DB read, never from the token. `Payload` gains `role?: UserRole` (access tokens only); `issueToken`/`issueTokenPair` widen to `Pick<UserEntity, 'id' \| 'role'>`. Amends [ADR 0002](ADR/0002-dual-secret-token-pair.md). **Unblocks the row below.** |
| Adapt the imported `admin/` console | Rewrite the [ADR 0022](ADR/0022-admin-console-import-from-chat-project.md) import from the Chat Project's API to this one, using that ADR's verified backlog as the brief. **Start with the role-management slice** — `PATCH /user/:id/role`, `GET /user`, `GET /user/:id`, `DELETE /user/:id`, `GET /audit-log`, and `POST /auth/signin` are already the right routes and the rank values `0/1/2` already match `ROLE_RANK`, so that part is route-level correction, not redesign. The chat-domain pages (`rooms-page`, presence/nickname widgets) and the whole Apollo/`/graphql` layer are deletions. Depends on the row above. **If the adapted user-list page needs to filter/sort by email or role, see the `GET /user` search/sort follow-up in section 7** — `GetUsersDto` currently has no field for it (execution #2 shipped take/skip only). |
| ~~`GET /user` pagination~~ **(execution #2 — pulled forward from Stage 5, done 2026-08-05)** | Closed the standing Never Do Group 2 violation (`findAll()` bound no `@Query()` and returned `findAndCount()` over every user). New `GetUsersDto` (`take`/`skip`, mirroring `GetFilesDto`); `UserService.findAll` sorts `createdAt DESC, id DESC` for deterministic pages; response kept the existing `[rows, total]` tuple shape (`GET /file` parity, no new ADR). Search/sort were left out of this pass' scope — open for the admin console task below if it needs them. |
| Resolve the duplicate admin surface | Delete whichever of the two loses: `frontend/src/features/admin/AdminPage.tsx` (ADR 0010's route section) or the standalone `admin/` app (ADR 0022). Deliberately decided **during** this stage, not before it — how much of the import survives adaptation is the input to the choice. Tracked as an open decision in section 7. |
| Decide whether moderation actions exist at all | The import calls `POST /user/:id/ban`, `/unban`, and `/force-logout`, and colors audit actions (`USER_BANNED`, `USER_MUTED`, `USER_UNBAN`, `FORCE_LOGOUT`) that **this project never emits** — `AUDIT_ACTIONS` is exactly `ROLE_CHANGE`, `USER_DELETE`, `FILE_DELETE`. Default answer is "no": delete them, since a video-upload board has no stated moderation requirement (YAGNI). Building any of them is new backend surface needing its own ADR — not a side effect of adapting a UI. |

## 7. Unscheduled / open decisions

- ADR 0026 content-endpoint follow-ups (recorded 2026-08-01, from a post-implementation
  review of `GET /file/:id/content`,
  [file-content.controller.ts](backend/file/file-content.controller.ts)), severity-ordered:
  1. **[medium] Missing stream error handling** — `createReadStream(...).pipe(res)` (200 and
     206 paths) attaches no `'error'` listener, so a read failure after headers are sent (a
     `DELETE /file/:id` racing an in-progress stream, or a disk fault) becomes an unhandled
     `'error'` event and crashes the process (Never Do Group 1). Fix: `stream.on('error', …)`
     that destroys the response and logs at `warn`.
  2. **[low] Suffix `Range: bytes=-N` mishandled** — a last-N-bytes request is served as the
     first N+1 bytes; players use `bytes=N-`, so impact is low. Add the suffix branch when
     convenient.
  Non-code observations (no fix): the `416` reply omits an `ErrorBody` code (protocol-level);
  a rejected multi-field upload leaves temp orphans the ADR 0018 sweep reclaims; `file/temp`
  stays statically served (pre-existing, outside the visibility scope). Full write-up in
  [ADR 0026](ADR/0026-file-visibility-implementation.md) > Known limitations.
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
- Frontend adoption of the upload claim contract (recorded 2026-07-27,
  [ADR 0019](ADR/0019-upload-claim-idempotency.md)) — **owned by a frontend-scoped
  task, not by backend work**. `POST /file` now answers 200 (idempotent replay) as
  well as 201, and 409 `FILE_ALREADY_CLAIMED` is a status this API had never emitted
  before. `frontend/docs/API-CONTRACT.md` and the client's upload flow must both be
  updated; until then the frontend treats a replay as a fresh creation and has no
  branch for 409. The backend change deliberately stopped at the repo boundary
  ([CLAUDE.md](CLAUDE.md) > Project Overview: `frontend/` has its own scoped
  CLAUDE.md and tooling — do not edit frontend files from a backend task).
- Frontend adoption of the deletion contract (recorded 2026-07-30,
  [ADR 0020](ADR/0020-account-deletion-cascade.md)) — **owned by a frontend-scoped task,
  not by backend work**, exactly like the claim-contract item above. `DELETE /user/:id`
  now needs `?deleteFiles=true` for an account that owns files, and answers 409
  `USER_HAS_FILES` (count in the message) otherwise; the warning dialog, the confirmed
  retry, and the 409 branch all live in `frontend/`. `frontend/docs/API-CONTRACT.md` and
  the account-deletion flow must both take it up; until they do, the frontend has no path
  that can pass the confirmation. The backend change stopped at the repo boundary
  ([CLAUDE.md](CLAUDE.md) > Project Overview).
- Reclaiming orphaned `granted_` files (recorded 2026-07-30,
  [ADR 0020](ADR/0020-account-deletion-cascade.md)) — deletion now unlinks stored files
  post-commit and best-effort, so two narrow cases can still leave bytes in `file/upload`
  with no row: a failed `unlink` (logged at `warn`) and a file inserted between the path
  read and the cascade delete. Nothing sweeps that folder. Deliberately **not** solved by
  copying ADR 0018's sweep: "on disk without a row" cannot be decided from the filename
  alone, so it needs a DB-joined reconciliation with its own ADR. Unscheduled — the
  accepted residual is disk waste, never a broken record.
- ~~File ownership reassignment can break the post↔file same-creator invariant~~ — ✅
  **settled 2026-07-31** ([ADR 0024](ADR/0024-account-cascade-fk-refusal.md)), the gate the
  comment module waited on. Of the three candidates, *translate the `23503` into a typed
  refusal* was chosen: `FileService.deleteFilesOfCreator` now answers 409
  `USER_FILES_IN_USE`, matching what its sibling `deleteFile` already did for
  `FILE_IN_USE`. Rejecting the other two mattered as much as choosing this one — widening
  the cascade would have destroyed third-party posts *and* rewritten the delete order the
  comment task extends, and a composite FK enforcing the rule in the database is recorded
  in that ADR as the shape to adopt if the property is ever needed as a guarantee rather
  than merely handled. What remains is deliberate, not residual: the same-creator rule is
  now a **creation-time rule**, so an account whose file sits in a stranger's post cannot be
  deleted until that post is (409, and any admin can clear it). **The feature underneath it
  is still undecided** — see the next entry.
- **Whether `PATCH /file/:id { userId }` should exist at all** (recorded 2026-07-31,
  [ADR 0024](ADR/0024-account-cascade-fk-refusal.md)) — the field on `UpdateFileDto`
  reassigns `file_entity.creatorId`, transferring a file to another account outright: the
  previous owner loses every write right, and the recipient never consents.
  [ADR 0007](ADR/0007-ownership-checks-without-rbac.md) is the only ADR that mentions it, and
  only to say the *guard* is creator-only — **no decision anywhere argues why a user needs to
  hand a file to someone else.** It arrived as a field on the original CRUD DTO and every
  later decision has treated it as given, which is exactly how it came to be the sole cause of
  the invariant break ADR 0024 had to absorb. Three candidate outcomes, each a decision rather
  than a patch: keep it with a stated rationale; keep it but add recipient consent (a
  pending-transfer row — a schema change); or drop the field, after which the global pipe's
  `forbidNonWhitelisted` turns any client still sending `userId` into a 400
  `VALIDATION_FAILED` rather than a silent no-op. **Dropping it is not free**: with no
  reassignment the same-creator rule becomes a true invariant again, which would make ADR
  0024's `23503` branch *and* `PostService.resolveAttachment`'s author-identity check
  unreachable guards — both would have to be removed in the same change, so that option
  supersedes ADR 0024 rather than sitting beside it. Needs its own ADR.
- Deferred list-query indexes (recorded 2026-07-30,
  [ADR 0021](ADR/0021-list-query-search-filter-sort.md)) — the search/filter/sort task
  deliberately shipped **no index**: at this table's size all three candidates are
  unmeasured speculation. Each is a plain-text description awaiting a measurement, and each
  needs approval plus line-by-line review of `migration:generate` output before it lands:
  `("createdAt" DESC, "id" DESC)` for the default sort and page boundary (justified around
  ~10⁴+ rows); `pg_trgm` GIN on `lower(title)`, which is the *precondition* for
  `ILIKE '%term%'` to use an index at all and therefore a two-part migration (extension +
  index); and `("creatorId")`, which Postgres does not create automatically and which would
  serve both the new filter and the account cascade
  ([ADR 0020](ADR/0020-account-deletion-cascade.md)). Until then `search`/`creatorId` are
  sequential scans and the sort is a full sort — the accepted trade at this scale. Reverse it
  on measurement, not intuition.
- Frontend adoption of the list-query parameters (recorded 2026-07-30,
  [ADR 0021](ADR/0021-list-query-search-filter-sort.md)) — **owned by a frontend-scoped
  task, not by backend work**, like the claim- and deletion-contract items above.
  `GET /file` now accepts `search`, `sortBy`, `order`, and `creatorId`, and returns results
  ordered newest-first by default where the order was previously arbitrary.
  `frontend/docs/API-CONTRACT.md` and the list view (search box, sort control, author
  filter) must both take it up; until they do, the frontend simply keeps sending
  `take`/`skip` and gets the new deterministic ordering for free. The backend change stopped
  at the repo boundary ([CLAUDE.md](CLAUDE.md) > Project Overview).
- ~~Frontend adoption of file visibility + media expansion~~ — ✅ **resolved 2026-08-03**
  (recorded 2026-07-31, [ADR 0025](ADR/0025-file-visibility-and-media-expansion.md); both
  backend halves landed 2026-08-01 — visibility via
  [ADR 0026](ADR/0026-file-visibility-implementation.md), media-type expansion via
  [ADR 0027](ADR/0027-media-type-expansion-implementation.md)). All four pieces this item
  called out are now live in `frontend/`: the file board (search/sort/filter/pagination/
  visibility badges, `FileBoard.tsx`), the file detail page (visibility-gated playback — a
  direct `<video src>` for public/unlisted, an authenticated blob+objectURL fetch for
  private), file management actions (visibility toggle, share-link rotation, delete, all via
  `PATCH`/`DELETE /file/:id`), and the upload form (`image`/`audio`/`video` fields mirroring
  ADR 0027's per-field allowlist, plus XHR-based upload-progress reporting, added in the same
  task, since `fetch` has no upload-progress event). `frontend/docs/API-CONTRACT.md` documents
  the content-endpoint `fileUrl`/`visibility`/`shareUrl` shape and the three-field upload
  contract.
- Documentation rot in `ARCHITECTURE.md` (+ko) (recorded 2026-07-30) — the Stage 1
  landings were never reflected there: "Non-Existent Infrastructure" still claims no CI
  workflow, no Dockerfile, and no Nest `Logger` usage (all three exist —
  [ADR 0015](ADR/0015-docker-and-compose.md)/[0016](ADR/0016-github-actions-ci.md)/[0017](ADR/0017-logging-conventions.md)),
  Jest `roots` is written as `["src"]` (actually `["backend"]`), the Testing section
  describes no e2e suite, and `PATCH /user/:id` / `PATCH /file/:id` still read "Self only"
  / "Creator only" from before RBAC ([ADR 0013](ADR/0013-rbac-and-audit-log.md)). A
  dedicated doc-audit task, not a drive-by: mixing it into a feature commit would blur what
  that commit decided. **Same task, added 2026-07-30**: `CLAUDE.md`'s Never Do Group 2
  pagination example still cites `getFiles(take, skip)` as the current signature — it takes
  a `GetFilesDto` since [ADR 0021](ADR/0021-list-query-search-filter-sort.md). The *rule*
  (list endpoints must paginate) is unaffected; only the example text lags, and `CLAUDE.md`
  was outside that task's stated document scope.
- ~~Adapting the imported `admin/` console~~ — **scheduled 2026-07-30 as
  [Stage 5](#stage-5--operational-surface-admin-console--added-2026-07-30)**, no longer
  unscheduled. Recorded here for one turn because the entry started life in this section: the
  Chat Project's console was imported to `admin/` unmodified as a declared modification base
  ([ADR 0022](ADR/0022-admin-console-import-from-chat-project.md)) for two purposes — supplying
  the **privilege-hierarchy operator surface** [ADR 0013](ADR/0013-rbac-and-audit-log.md) shipped
  without, and doing it at a fraction of the LLM token cost of regenerating a console already
  built for the same three-tier hierarchy. The verified modification backlog lives in ADR 0022;
  the task rows, their ordering, and the backend decisions they depend on are now Stage 5's.
- Which admin surface survives (recorded 2026-07-30,
  [ADR 0022](ADR/0022-admin-console-import-from-chat-project.md)) — **an open decision**, and it
  stays one even though the work is now scheduled: it is
  [Stage 5](#stage-5--operational-surface-admin-console--added-2026-07-30)'s fourth row, to be
  settled **during** that stage rather than before it. Two admin surfaces coexist:
  `frontend/src/features/admin/AdminPage.tsx` (the `/admin` route section
  [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md) specified, whose
  admin-placement clause ADR 0022 amends) and the imported standalone `admin/` app. Choosing
  now would be guessing — how much of the import survives adaptation is the input to the choice.
  If it turns out mostly deletable, ADR 0010's original route-section plan is the better path
  and this flips back to it.
- Doc-wording sync (deferred 2026-07-23; completed 2026-07-29): pre-plan
  "candidate" phrasings reconciled with this plan. ADR 0003 ("candidate
  roadmap item") now points at the landed [ADR 0018](ADR/0018-orphan-temp-file-cleanup.md);
  ADR 0006 Consequences ("top roadmap item") carries a dated landed note; and
  `CHAT-REMNANT-REMOVAL-PLAN` ("ROADMAP's CI candidate") now points at the landed
  Stage 1 CI ([ADR 0016](ADR/0016-github-actions-ci.md)). **Done.**
- In-code trade-off documentation gap for pre-mandate services (recorded 2026-08-02) —
  a full-codebase survey found trade-off reasoning is dense but **tiered**: the ADRs carry
  every decision-level trade-off (a `## Consequences` section plus rejected alternatives,
  5–39 markers each), while the call-site layer — the `이유` line of the mandatory
  목적/이유/방법 block ([CLAUDE.md](CLAUDE.md) > File Creation Convention) — is dense in the
  board/visibility-era services (`file.service` 17 blocks, `post.service` 12, `comment.service`
  8) but **absent in the oldest service, `auth.service.ts` (0 blocks)**, whose trade-offs live
  only in [ADR 0001](ADR/0001-basic-token-authentication.md) /
  [0002](ADR/0002-dual-secret-token-pair.md) / [0012](ADR/0012-refresh-cookie-rotation.md).
  This is **not a rule violation** — the block mandate (commit `995df5e`) binds only *new or
  modified* functions, and auth.service predates it and has not been touched since — so it is a
  documentation-density gap between the decision layer (dense) and the call-site layer (thin),
  not a defect. **Scheduled as a follow-up to run after all Stages complete**, deliberately not
  now: it is a documentation-only pass with no behavior change, and running it before the stages
  finish would churn functions a later stage (any auth-touching work) may modify anyway — which
  would add the blocks as a side effect and shrink the gap for free. The dedicated task
  retro-adds 목적/이유/방법 blocks to the pre-mandate services (auth.service the clearest case),
  each `이유` line pointing at its governing ADR. Not a drive-by: a repo-wide comment sweep is
  exactly the kind of change Scope Discipline keeps out of feature commits, so it lands as its
  own task once the staged work is done.
- `GET /user` search/sort (recorded 2026-08-05, as a follow-up from execution #2's
  `GET /user` pagination task, deferred to
  [Stage 5](#stage-5--operational-surface-admin-console--added-2026-07-30)) —
  the pagination task deliberately shipped **take/skip only**: the ROADMAP item named
  pagination specifically, and `GetFilesDto`'s `search`/`sortBy`/`order` surface
  ([ADR 0021](ADR/0021-list-query-search-filter-sort.md)) was not mirrored onto
  `GetUsersDto`. **Trigger for revisiting**: Stage 5's "adapt the imported `admin/` console"
  row — the imported user-list page (`ADR 0022` backlog: `GET /user?page&take&sort&sortBy&search&status`)
  will want to filter/sort the account list by email or role, and today's `GetUsersDto` has no
  field for it. If that need materializes, extend `GetUsersDto` with the same
  `search`/`sortBy`/`order` shape `GetFilesDto` already uses (email `ILIKE`, a
  `USER_SORT_FIELDS` tuple keyed the same way `FILE_SORT_FIELDS` is) rather than inventing a
  second read-layer pattern — no new ADR needed, same as the pagination task. Not scheduled
  as its own task: it is a plausible extension of Stage 5's console-adaptation row, not an
  independent debt like pagination was.

## 8. Advisory notes

Recorded criteria that inform but do not schedule work: privacy/compliance
(deletion policy, retention), release/change management (semver + migration
ordering), docs-as-code enforcement (automated README/endpoint consistency — a
candidate under the CI task).

## 9. Completed

### 2026-07-30

| Item | Notes |
|---|---|
| List search / filter / sort | `GET /file` gained four optional parameters — `search` (title `ILIKE '%term%'`, LIKE metacharacters escaped, ≤100 chars), `creatorId` (through the existing creator join), and `sortBy`/`order` mapped to columns by a total `Record<FileSortField, string>` so a client string never becomes a column name. Default `createdAt DESC` with `file.id` as a tiebreaker — the endpoint previously had **no `ORDER BY` at all**, making offset paging non-deterministic. Response shape unchanged, no new error codes (the boundary pipe rejects bad values as `VALIDATION_FAILED`), no schema change; the `createdAt`/`pg_trgm`/`creatorId` indexes are deferred with their triggers recorded — **first Stage 3 task** ([ADR 0021](ADR/0021-list-query-search-filter-sort.md)) |
| Board domain schema design | Design gate only — plain-text schema for **both** board entities at once, no code and no migration. post ↔ file is 1:1, optional, and same-creator (the unique nullable FK doubles as `POST /post`'s idempotency key: identical resubmit replays 200, differing payload 409 `POST_FILE_TAKEN`); comments are flat, with threading deferred as an additive migration; `comment.postId` carries the schema's **only** `ON DELETE CASCADE`, argued against ADR 0020's service-cascade rule rather than assumed; `DELETE /file/:id` on an attached file becomes 409 `FILE_IN_USE` by translating `23503` (a pre-check would have created a `File ↔ Post` module cycle **and** left a race); the ADR 0020 account cascade absorbs posts and comments while `deleteFiles=true` keeps guarding files only; ownership stays `canManage` with no third axis, and the post listing inherits the ADR 0021 read layer — **second Stage 3 task** ([ADR 0023](ADR/0023-board-domain-schema.md)) |
| Deletion policy design | Soft delete rejected with reasons recorded; deletion stays hard. `DELETE /user/:id?deleteFiles=true` cascades (file rows → account row → stored files, unlink post-commit), an unconfirmed delete of an account owning files returns the new 409 `USER_HAS_FILES` with the count, and `deleteFiles` is a validated string literal because implicit Boolean conversion measurably turns `"false"` into `true`. `DELETE /file/:id` now unlinks the stored `granted_` file — a leak found during this task. No schema change — **third Stage 2 task, Stage 2 complete** ([ADR 0020](ADR/0020-account-deletion-cascade.md)) |

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

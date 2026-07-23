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

## Current position (as of 2026-07-23)

- The 2026-07-22 hardening run is fully landed: security quick-wins, the
  zero-error lint baseline, the documentation rewrite, and TypeORM migration
  adoption (`79603ad`, [ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md)),
  followed by the Korean fluency pass over the `.ko.md` docs (`dc1ad72`).
- This plan itself was established on 2026-07-23 through the 11-axis review.
- Frontend split decided 2026-07-23 ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)):
  a separate frontend repository will consume this API; admin starts as an
  `/admin` route section inside it. RBAC is re-sequenced after Stage F — it
  adds permissions without changing the API surface, so deferring it costs the
  frontend no rework, while freezing the surface first saves it real rework.
- Route cleanup & contract freeze landed 2026-07-23: `POST /file`,
  `PATCH /file/:id`, `DELETE /file/:id`, `POST /auth/token/refresh` are the
  canonical routes; the API surface is now frozen (ADR 0010).
- **Next dedicated task: error-code system (Stage F)**.

## 1. Vision & essence

- **Today**: a portfolio/learning backend — the point is demonstrable
  engineering discipline (design, documentation, tests) on a small but complete
  API.
- **Target**: a production-oriented backend with a browser frontend as its
  decided consumer (separate repository, [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)).
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
- **Frontend split (decided 2026-07-23, [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md))**:
  a separate frontend repository consumes this API over HTTP; admin starts as
  an `/admin` route section inside that frontend and is promoted to its own
  app only after RBAC lands and real admin requirements exist. A pnpm-workspace
  monorepo and an immediate three-way split (frontend/backend/admin) were
  considered and rejected as premature.
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

### Stage 0 — decided architecture work (RBAC)

| Task | Rationale / dependencies |
|---|---|
| **RBAC** — `role` column + role-aware guard | Decided 2026-07-22; design fixed: three tiers (`user`/`admin`/`superadmin`), `PATCH /user/:id/role` superadmin-only, ownership checks extend to "self **or** admin". Deferred behind Stage F (2026-07-23) — RBAC adds permissions without changing the API surface, so no frontend rework results. The `role` column ships as a reviewed migration. |

### Stage 1 — Foundation (reproducibility · observability · test reliability)

| Task | Rationale / dependencies |
|---|---|
| Pin Node/pnpm (`engines` + `.nvmrc`) | Near-zero cost; closes the gap CLAUDE.md documents ("versions are NOT pinned"); becomes the single source for the Docker base-image tag. |
| Docker / docker-compose (app + local PostgreSQL) | Removes manual DB provisioning — the biggest onboarding and E2E blocker; precondition of the AWS stage. |
| CI — GitHub Actions (lint + test) | The 0-error lint baseline is only human-enforced today; a minimal pipeline, nothing more. |
| Logging conventions (Nest Logger first) | First observability increment; external error tracking (e.g. Sentry) deferred until the deploy environment is fixed. |
| E2E rewrite | Auth flow, ownership 403s, pagination, `temp_` → `granted_` promotion. Depends on the Docker DB. |

### Stage 2 — Mechanism hardening

| Task | Rationale / dependencies |
|---|---|
| Orphan temp-file cleanup | `temp_` files accumulate forever when `POST /file` is never called — the only unmanaged resource leak today. |
| Deletion policy design (soft delete + FK) | One design task uniting the soft-delete question with the `DELETE /user/:id` FK-constraint 500 (`FileEntity.creator` is `nullable: false`). |
| Upload idempotency / duplicate policy | CLAUDE.md requires new write endpoints to state their duplicate-submission behavior — settle the frame before board expansion multiplies write endpoints. |

### Stage 3 — Domain expansion

| Task | Rationale / dependencies |
|---|---|
| List search / filter / sort | Prerequisite for board listings; `GET /file` is QueryBuilder-based, so the extension path exists. |
| Board domain — post/comment modules | New domain modules (sanctioned by module policy); plain-text schema description first, then reviewed migrations; RBAC, ownership, and pagination patterns apply from day one. |

### Stage 4 — Production transition

| Task | Rationale / dependencies |
|---|---|
| AWS container deployment | Local: Docker (compose); deploy: AWS, container-based. New deployment ADR; depends on Stage 1 Docker + CI. |
| VOD playback access control | Uploaded files are currently public URLs — anyone with the link can watch. An authenticated playback path; includes revisiting ADR 0005's static-serving decision. (Playback of uploaded files, not live streaming.) |
| Storage port-adapter | Only if/when the S3 need is confirmed — see Architecture direction (section 4). |
| Performance / capacity criteria | Index policy, response-time targets, disk ceilings — measured before optimized. |

## 7. Unscheduled / open decisions

- License: `package.json` says `UNLICENSED`; the pre-rewrite README claimed
  MIT — decide before the repo is published.
- Chat-project remnant handling ([plan](CHAT-REMNANT-REMOVAL-PLAN.md)):
  git-history decision + re-verification trigger for new or pasted-in docs.
- Dev-transitive `pnpm audit` findings (handlebars via ts-jest; glob/minimatch
  via jest and @nestjs/cli) — build/test-time only; waiting on upstream
  releases.
- API versioning timing — the consumer is now decided; versioning activates
  when a post-freeze breaking change actually needs it (see Design criteria).
- Frontend stack choice (framework, build tool, hosting) — a frontend-repo
  decision; nothing in this repo depends on it.
- Whether `POST /auth/signin/local` stays as a second signin path long-term —
  it survives the Stage F freeze; the frontend will pick one canonical signin
  route, and the other's fate is decided then.
- Doc-wording sync (deferred 2026-07-23): three pre-plan "candidate" phrasings
  are now superseded by this plan — ADR 0003 ("candidate roadmap item" → decided
  Stage 2), ADR 0006 Consequences ("top roadmap item" → landed),
  CHAT-REMNANT-REMOVAL-PLAN ("ROADMAP's CI candidate" → decided Stage 1). Fix on
  the next doc pass: dated one-line notes for the ADRs (per the ADR 0006
  implementation-note precedent), direct wording for the living plan doc.

## 8. Advisory notes

Recorded criteria that inform but do not schedule work: privacy/compliance
(deletion policy, retention), release/change management (semver + migration
ordering), docs-as-code enforcement (automated README/endpoint consistency — a
candidate under the CI task).

## 9. Completed

### 2026-07-23

| Item | Notes |
|---|---|
| Full roadmap plan established | 11-axis decision review; this document is its record |
| Frontend split decision + Stage F pipeline | Separate frontend repo, admin as `/admin` route, contract freeze; RBAC re-sequenced after Stage F ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.md)) |
| Route cleanup & API contract freeze | `POST /file`, `PATCH /file/:id`, `DELETE /file/:id`, `POST /auth/token/refresh` — surface frozen with zero consumers (Stage F task 1) |

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
| TypeORM migration adoption | `migration:*` scripts, `src/data-source.ts`, baseline `InitialSchema`; pre-existing DBs: `pnpm migration:run -- --fake` once ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md)) |

# ADR 0010: Frontend Split and API Surface Freeze

- Status: Accepted
- Date: 2026-07-23
- 한국어: [0010-frontend-split-and-api-surface-freeze.ko.md](0010-frontend-split-and-api-surface-freeze.ko.md)

## Context

The project has been a backend-only portfolio API with Swagger as its sole
consumer. A browser frontend is now wanted. That raises three structural
questions at once: where the frontend lives (same repo or not), whether an
admin surface is a separate application, and what happens to the API contract
the moment a real consumer starts depending on it. Today there are **zero
consumers** — every breaking API change is still free. Opt-in CORS
([ADR 0008](0008-opt-in-cors.md)) already anticipates a cross-origin frontend.

## Decision

> **Amended 2026-07-24**: the "where the frontend lives" decision is corrected
> from *separate repository* to a **`frontend/` subfolder in this same
> repository** — the originally intended structure. Everything else in this ADR
> (API surface freeze, admin as an `/admin` route, RBAC deferral, static-serving
> constraint) stands unchanged. The first bullet below reflects the correction;
> the pnpm-workspace monorepo remains rejected because in-repo ≠ workspace
> restructure (see below).

- **Frontend in the same repository, as a `frontend/` subfolder.** The backend
  stays at the repo root, untouched; the frontend lives beside it under
  `frontend/` and is tracked in the same git history. This is *not* a
  pnpm-workspace monorepo — the backend is **not** relocated into `apps/backend`
  and its Jest/migration paths, tooling, and root `CLAUDE.md` are unaffected;
  the `frontend/` folder simply carries its own `package.json`, tooling, and
  scoped `CLAUDE.md`. It consumes the backend over HTTP (dev: a Vite proxy;
  prod: `CORS_ORIGIN`). Keeping both in one repo makes an API-contract change
  and its client update land in one commit, at near-zero structural cost.
- **Admin starts as a route section (`/admin/*`) inside the frontend**, not as
  a third application. Promotion to a dedicated admin app is reconsidered only
  after RBAC lands and real admin requirements exist. A three-way split today
  would ship an app the backend cannot even distinguish (no roles yet).
- **Route canonicalization, then freeze.** Before the first consumer appears,
  the four non-canonical routes are renamed:
  `POST /file/uploadFile` → `POST /file`,
  `PATCH /file/patch/:id` → `PATCH /file/:id`,
  `DELETE /file/delete/:id` → `DELETE /file/:id`,
  `POST /auth/token/refreshaccess` → `POST /auth/token/refresh`.
  After that the API surface is **frozen**: breaking route changes require a
  versioning decision (see ROADMAP > Design criteria > API contract stability).
  A plural rename (`/user` → `/users`, `/file` → `/files`) was considered and
  rejected — app-wide singular naming is consistent, and consistency outranks
  REST cosmetics.
- **RBAC is re-sequenced after frontend preparation** (ROADMAP Stage F). RBAC
  adds permissions without changing the API surface, so deferring it costs the
  frontend no rework; freezing the surface first does the reverse.
- **Static file serving stays unauthenticated until Stage 4.** Uploaded files
  remain public URLs (`{BASE_URL}/file/upload/granted_...`) — anyone with the
  link can fetch them — until the Stage 4 VOD playback access-control task
  revisits [ADR 0005](0005-local-disk-storage.md). Accepted as a documented
  known constraint, not fixed early.

## Alternatives rejected

- **Monorepo (pnpm workspace)** — relocating the backend into `apps/backend`
  and rewriting its tooling is unnecessary cost; the chosen in-repo `frontend/`
  subfolder gets single-repo atomic commits without that restructure. (A fully
  *separate* repository was also considered and set aside 2026-07-24 in favor of
  the one-repo subfolder — see the amendment above.)
- **Three-way split (frontend / backend / admin)** — premature: no roles on the
  backend, no admin requirements written down; ordering problem, not a wrong
  target.
- **Plural route rename** — cosmetic gain, repo-wide consistency loss.

## Consequences

- ROADMAP gains a **Stage F — Frontend preparation** pipeline preceding
  Stage 0: route cleanup & contract freeze → error-code system (global
  exception filter) → refresh-token httpOnly-cookie move + rotation (pulled
  forward from Stage 2).
- The cookie/rotation task will need its own ADR amending
  [ADR 0002](0002-dual-secret-token-pair.md)'s "no server-side token storage"
  stance, plus a reviewed schema migration — acknowledged here, not decided
  here.
- The frontend stack choice and the long-term fate of `POST /auth/signin/local`
  (it survives the freeze) remain open decisions in ROADMAP section 7.
- Once the frontend consumes the API, every breaking change stops being free —
  the Swagger-only era of casual renames ends with this ADR.

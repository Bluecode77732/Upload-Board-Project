# `admin/` — Imported Admin Console (NOT yet adapted to this project)

> 한국어 버전: [README.ko.md](README.ko.md)

## Read this first

**Every file in this folder is a copy of a different project's application.** It was imported
from the author's **Chat Project** (NestJS + GraphQL + Redis + Socket.IO) and committed
**unmodified**. It targets the Chat Project's API, not this repository's.

**It does not work against this backend yet, and it is not supposed to.** It exists as a
*modification base*.

## Why it is here — two purposes

1. **User privilege-hierarchy management.** RBAC landed in
   [ADR 0013](../ADR/0013-rbac-and-audit-log.md) — three tiers (`user`/`admin`/`superadmin`)
   with a `ROLE_RANK` ordering, a superadmin-only `PATCH /user/:id/role`, and a `ROLE_CHANGE`
   audit trail — but shipped **no way to operate any of it**. Today the first superadmin comes
   from the `SUPERADMIN_EMAIL` boot seed, and every promotion or demotion after that is a raw
   HTTP call or a Swagger form. Worse, the two invariants that protect the hierarchy are
   invisible to whoever is using it: demoting the **last** superadmin is refused
   (400 `AUTH_LAST_SUPERADMIN`), and **any** role change nulls the target's `refreshTokenHash`,
   ending their session immediately. This console is the operator surface for that.
2. **Token economy.** The Chat Project's console was already built against the **same** three-tier
   hierarchy (this project's RBAC design is recorded in ROADMAP as "Chat-project style"), and its
   users page already has the role column, the assignment control, the per-user detail panel, and
   the per-user audit slice. Importing that plus its scaffolding (router, route guard, auth store,
   single-flight silent refresh, axios interceptors, Playwright + Vitest harnesses) costs a
   fraction of the LLM tokens that regenerating it prompt-by-prompt would.

Purpose 1 is the requirement — why an admin console is wanted. Purpose 2 is the method — why it
arrived as a copy instead of as new code.

- Full decision, rejected alternatives, and consequences:
  [ADR 0022](../ADR/0022-admin-console-import-from-chat-project.md)
- Adapting it is **its own dedicated task** ([CLAUDE.md](../CLAUDE.md) > Scope Discipline).
  Do not treat it as a drive-by cleanup, and do not assume any line in it reflects this
  project's contracts.

## Status

| | |
|---|---|
| Provenance | Chat Project admin console, imported 2026-07-30 |
| Adapted to this API? | **No** — see the backlog below |
| Wired into root tooling? | **No** — outside the lint glob, Jest `roots`, `tsconfig.build.json`, `docker-compose.yml`, and CI |
| Dependencies | Own `package.json` / `node_modules`; **not** a pnpm workspace (same precedent as `frontend/`) |
| Runs today? | Builds and serves standalone, but every backend call targets a route this API does not have |

Root `pnpm lint`, `pnpm test`, and `pnpm test:e2e` cannot reach this folder, so nothing in here
can break the backend pipeline.

## Where to start — the role-management slice already lines up

Because both projects implement the same hierarchy, the role-management calls target routes this
API **actually has**. Adaptation should start here: the work is route-level correction, not
redesign.

| Imported call | This project's route | Status |
|---|---|---|
| `api.patch('/user/:id/role', { role })` | `PATCH /user/:id/role` — superadmin-only | Route matches; body encoding does not |
| `api.get('/user', …)` | `GET /user` — admin-only | Route matches; params ignored, unpaginated |
| `api.get('/user/:id')` | `GET /user/:id` | Route matches; `nickname`/`status` absent here |
| `api.delete('/user/:id')` | `DELETE /user/:id` | Route matches; missing `?deleteFiles=true` |
| `api.get('/audit-log', …)` | `GET /audit-log` — admin-only | Route matches; filters differ, no `/export` |
| `api.post('/auth/signin', …)` (Basic) | `POST /auth/signin` — Basic token | Matches |
| Ranks `0 / 1 / 2` | `ROLE_RANK` = `user: 0, admin: 1, superadmin: 2` | **Identical** — the model transfers |

The chat-domain pages (`rooms-page.tsx`, presence/nickname widgets) and the Apollo layer have no
counterpart at all — those are deletions, not rewrites.

## What must change before it runs

Verified against this repository's code on 2026-07-30. Every row was *correct* in the Chat
Project — each is a defect only relative to this project. The role rows come first because they
carry the privilege-hierarchy purpose.

| Area | Imported code expects | This project has |
|---|---|---|
| Role encoding | `{ role: 1 }` (numeric), labels via `Record<number, string>` | `UserRole` **string enum**; `UpdateRoleDto` uses `@IsEnum` — a numeric body is 400 `VALIDATION_FAILED`. The **ranks are already correct** ([ADR 0013](../ADR/0013-rbac-and-audit-log.md)) |
| Role source | `jwtDecode<{ sub, role }>(accessToken)` | Access-token payload is `{ sub, type }` — **no `role` claim**, so the guard reads `undefined` and rejects everyone. How the client learns its role is a **backend decision** first |
| Who may assign roles | Any admin sees the role control | `PATCH /user/:id/role` is **superadmin-only** — `RolesGuard` throws 403 `FORBIDDEN` for a mere admin |
| Hierarchy invariants | No branch for either | Last-superadmin demotion refused (400 `AUTH_LAST_SUPERADMIN`); any role change ends the target's session (`refreshTokenHash` nulled) |
| Role labels | `role === 1 ? 'admin' : 'user'` | Three tiers — `superadmin` cannot be expressed by that check |
| Audit actions | Colors 6 actions incl. `FORCE_LOGOUT`, `USER_BANNED`, `USER_MUTED`, `USER_UNBAN` | `AUDIT_ACTIONS` is exactly `ROLE_CHANGE`, `USER_DELETE`, `FILE_DELETE` |
| Superadmin bootstrap docs | `e2e/.env.example` + `e2e/seed-superadmin.mjs` cite "CLAUDE.md's Role Population Invariants" | **No such section here** — it is the Chat Project's. The real mechanism is `SUPERADMIN_EMAIL` + `superadmin-seed.service.ts`. Their *claim* ("no in-app flow creates a superadmin") is true here too; only the citation is wrong |
| Transport | Apollo Client against `/graphql` (`src/api/apollo.ts`, `src/api/graphql-operations.ts`, and the Apollo hooks in `dashboard-page`, `rooms-page`, `logs-page`) | **REST only — no `/graphql` route** ([ADR 0009](../ADR/0009-rest-only-api-with-swagger.md)) |
| Refresh route | `POST /auth/token/refreshaccess` | `POST /auth/token/refresh` ([ADR 0012](../ADR/0012-refresh-cookie-rotation.md)) |
| Sign-out route | `POST /auth/signOut` | `POST /auth/signout` (lower-case) |
| Domain pages | `rooms-page.tsx`, `getOnlineUser`, `getUserNicknames` | No rooms, presence, or nicknames — this domain is **uploaded video files** |
| User actions | `POST /user/:id/ban` \| `/unban` \| `/force-logout` | **None exist** |
| User list query | `GET /user?page&take&sort&sortBy&search&status` | `findAll()` binds no `@Query()` — returns every user, unpaginated |
| Audit log | `?action&page&sort&userId&from&to` + `GET /audit-log/export` | `action`, `take`, `skip` only; **no `/export`** |
| Paging model | `page` + `take` | `take` + `skip` (offset) ([ADR 0021](../ADR/0021-list-query-search-filter-sort.md)) |
| User deletion | `DELETE /user/:id`, no confirmation | `?deleteFiles=true` required when the account owns files, else 409 `USER_HAS_FILES` ([ADR 0020](../ADR/0020-account-deletion-cascade.md)) |
| Error handling | Ad-hoc status/message checks | Frozen `{ code, message }` contract — branch on `code` ([ADR 0011](../ADR/0011-error-code-contract.md)) |
| Deploy config | `vercel.json` with a CSP pinned to the Chat Project's Railway host | **No deploy target**; AWS is a Stage 4 roadmap item. Rewrite or delete before deploying anywhere |

`vercel.json` is left untouched deliberately, so the adaptation task can diff against the
original rather than a half-edited file.

## Related decisions

- [ADR 0022](../ADR/0022-admin-console-import-from-chat-project.md) — this import; amends
  ADR 0010's admin-placement clause
- [ADR 0010](../ADR/0010-frontend-split-and-api-surface-freeze.md) — originally placed admin as
  an `/admin` route section inside `frontend/`. That section
  (`frontend/src/features/admin/AdminPage.tsx`) **still exists**; which of the two surfaces
  survives is an open decision in [ROADMAP.md](../ROADMAP.md) > Unscheduled
- [CHAT-REMNANT-REMOVAL-PLAN.md](../CHAT-REMNANT-REMOVAL-PLAN.md) — this folder is a *declared*
  design import (bucket 4), not an unlabelled remnant. That classification holds only while
  this file and ADR 0022 keep stating that the code targets the Chat Project's API

## Local commands

Run from inside `admin/`. These are the imported scripts, unchanged.

```bash
pnpm install     # admin/ has its own dependency tree
pnpm dev         # Vite dev server on port 5174
pnpm build       # tsc -b && vite build
pnpm lint        # admin/'s own eslint config
pnpm test        # Vitest (src/**/*.{test,spec}.{ts,tsx})
pnpm e2e         # Playwright — expects Chat Project routes, so it fails here
pnpm e2e:seed    # Seeds a superadmin; needs e2e/.env (git-ignored)
```

Copy `.env.example` to `.env` and `e2e/.env.example` to `e2e/.env`. Both `.env` files, plus
`node_modules/` and `dist/`, are git-ignored by `admin/.gitignore` — no secrets are tracked.

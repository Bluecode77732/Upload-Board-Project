# `admin/` — Imported Admin Console (NOT yet adapted to this project)

> 한국어 버전: [README.ko.md](README.ko.md)

## Read this first

**Every file in this folder is a copy of a different project's application.** It was imported
from the author's **Chat Project** (NestJS + GraphQL + Redis + Socket.IO) and committed
**unmodified**. It targets the Chat Project's API, not this repository's.

**It does not work against this backend yet, and it is not supposed to.** It exists as a
*modification base*: the domain-independent scaffolding an admin console needs (router, route
guard, auth store, single-flight silent refresh, axios interceptors, Playwright + Vitest
harnesses) already existed in working, tested form, and importing it costs far fewer LLM tokens
than regenerating it prompt-by-prompt. That economic rationale is the whole reason this folder
is here.

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

## What must change before it runs

Verified against this repository's code on 2026-07-30. Every row was *correct* in the Chat
Project — each is a defect only relative to this project.

| Area | Imported code expects | This project has |
|---|---|---|
| Transport | Apollo Client against `/graphql` (`src/api/apollo.ts`, `src/api/graphql-operations.ts`, and the Apollo hooks in `dashboard-page`, `rooms-page`, `logs-page`) | **REST only — no `/graphql` route** ([ADR 0009](../ADR/0009-rest-only-api-with-swagger.md)) |
| Refresh route | `POST /auth/token/refreshaccess` | `POST /auth/token/refresh` ([ADR 0012](../ADR/0012-refresh-cookie-rotation.md)) |
| Sign-out route | `POST /auth/signOut` | `POST /auth/signout` (lower-case) |
| Role type | `role: number`, gate `(role ?? -1) < 1` | `UserRole` **string enum** + `ROLE_RANK` ([ADR 0013](../ADR/0013-rbac-and-audit-log.md)) |
| Role source | `jwtDecode<{ sub, role }>(accessToken)` | Access-token payload is `{ sub, type }` — **no `role` claim**, so the guard currently reads `undefined` and rejects everyone |
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

# `admin/` — Admin Console (adapted 2026-08-06: role-management slice)

> 한국어 버전: [README.ko.md](README.ko.md)

## Read this first

**Every file in this folder started as a copy of a different project's application.** It was
imported from the author's **Chat Project** (NestJS + GraphQL + Redis + Socket.IO) and committed
**unmodified** on 2026-07-30. It targeted the Chat Project's API, not this repository's.

**As of 2026-08-06, the role-management slice (login, dashboard, users, audit log) has been
adapted to this backend's actual REST contract** — see "What was adapted" below. The chat-domain
surface (rooms, presence, Apollo/GraphQL) had no counterpart here and was deleted, not rewritten.

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
   users page already had the role column, an assignment control, and a per-user detail panel.
   Importing that plus its scaffolding (router, route guard, auth store, single-flight silent
   refresh, axios interceptors, Playwright + Vitest harnesses) cost a fraction of the LLM tokens
   that regenerating it prompt-by-prompt would have.

Purpose 1 is the requirement — why an admin console is wanted. Purpose 2 is the method — why it
arrived as a copy instead of as new code, and why the adaptation below is a targeted correction
rather than a rewrite from scratch.

- Full import decision, rejected alternatives, and consequences:
  [ADR 0022](../ADR/0022-admin-console-import-from-chat-project.md)
- This adaptation is **ROADMAP Stage 5's second row** ("adapt the imported `admin/` console"),
  unblocked by the first row — the access token gained a `role` claim in
  [ADR 0028](../ADR/0028-access-token-role-claim.md) (execution order #3), which this console's
  route guard depends on to gate `/dashboard`, `/users`, and `/logs`.

## Status

| | |
|---|---|
| Provenance | Chat Project admin console, imported 2026-07-30; role-management slice adapted 2026-08-06 |
| Adapted to this API? | **Yes** — login/dashboard/users/logs (see "What was adapted"). Deploy config (`vercel.json`) is untouched; there is still no deploy target |
| Wired into root tooling? | **No** — outside the lint glob, Jest `roots`, `tsconfig.build.json`, `docker-compose.yml`, and CI. This is deliberate (ADR 0022), not a gap |
| Dependencies | Own `package.json` / `node_modules`; **not** a pnpm workspace (same precedent as `frontend/`). `@apollo/client`, `graphql`, and `rxjs` were dropped with the chat-domain deletion |
| Runs today? | Yes, against a real backend on `:3000` — see "Local commands" for the one-time `CORS_ORIGIN` setup this needs (admin runs on its own origin, `:5174`, unlike `frontend/`'s same-origin Vite proxy) |

Root `pnpm lint`, `pnpm test`, and `pnpm test:e2e` cannot reach this folder, so nothing in here
can break the backend pipeline.

## What was adapted

Every row below was *correct* in the Chat Project — each was a defect only relative to this
project, verified against this repository's code on 2026-08-06 (re-verified against 2026-07-30's
findings; one backend change landed in between — see the `FORBIDDEN` row).

| Area | Imported code expected | This project has | Resolution |
|---|---|---|---|
| Role encoding | `{ role: 1 }` (numeric), labels via `Record<number, string>` | `UserRole` **string enum** (`'user' \| 'admin' \| 'superadmin'`) | `auth.store.ts`'s `role` is now `UserRole`; a `ROLE_RANK`/`ROLE_LABEL` lookup (`src/auth/role.ts`, new) replaces every numeric compare |
| Role source | `jwtDecode<{ sub, role }>(accessToken)` | Access-token payload now carries `role` ([ADR 0028](../ADR/0028-access-token-role-claim.md)) | `session-guard.ts`, `login-page.tsx`, `protected-route.tsx` decode `role` as `UserRole \| undefined` and gate on `ROLE_RANK[role] >= ROLE_RANK.admin` |
| Who may assign roles | Any admin sees the role control | `PATCH /user/:id/role` is **superadmin-only**; `updateRole` has no rank ceiling on the target (only refuses the last-superadmin demotion) | `users-page.tsx` renders the role `<select>` only when `myRole === 'superadmin'`, on every row including the actor's own and other superadmins' — matching what the endpoint actually allows |
| Hierarchy invariants | No branch for either | Last-superadmin demotion refused (400 `AUTH_LAST_SUPERADMIN`); any role change ends the target's session (`refreshTokenHash` nulled) | `updateRole()` in `users-page.tsx` branches on the `AUTH_LAST_SUPERADMIN` code for a distinct message; the session-ending side effect needs no client handling (correct as-is) |
| Role labels | `role === 1 ? 'admin' : 'user'` (binary) | Three tiers | Replaced the promote/demote toggle with a 3-option `<select>` (user/admin/superadmin) — see the "role-change UI" decision below |
| Privilege-escalation guard *(found during this pass, not in the 2026-07-30 survey)* | No such check existed anywhere | `PATCH`/`DELETE /user/:id` now refuse (403 `FORBIDDEN`) an admin acting on an equal-or-higher-ranked target — closed the same day as this adaptation | `users-page.tsx` only renders the Delete button when `ROLE_RANK[myRole] > ROLE_RANK[target.role]`, and `deleteUser()` still branches on `FORBIDDEN` defensively (a role can change between page load and click) |
| Audit actions | Colors 6 actions incl. `FORCE_LOGOUT`, `USER_BANNED`, `USER_MUTED`, `USER_UNBAN` | `AUDIT_ACTIONS` is exactly `ROLE_CHANGE`, `USER_DELETE`, `FILE_DELETE`, `POST_DELETE`, `COMMENT_DELETE` | `logs-page.tsx`'s `ACTIONS` list and both pages' `actionColor()` now match exactly |
| Superadmin bootstrap docs | `e2e/.env.example` + `e2e/seed-superadmin.mjs` cited "CLAUDE.md's Role Population Invariants" | No such section anywhere in this repo — the real mechanism is `SUPERADMIN_EMAIL` + `superadmin-seed.service.ts` | Both files' citations corrected; `seed-superadmin.mjs`'s SQL now inserts the string `'superadmin'` (not `role=2, "isAI"=false` — `isAI` doesn't exist on `UserEntity`), and its `.env` search path was fixed to the actual root `.env` (there is no `backend/.env`) |
| Transport | Apollo Client against `/graphql` (`src/api/apollo.ts`, `src/api/graphql-operations.ts`, Apollo hooks in `dashboard-page`/`rooms-page`/`logs-page`) | **REST only — no `/graphql` route** ([ADR 0009](../ADR/0009-rest-only-api-with-swagger.md)) | Both files deleted; `main.tsx`'s `ApolloProvider` removed; `@apollo/client`/`graphql` dropped from `package.json` |
| Refresh route | `POST /auth/token/refreshaccess` | `POST /auth/token/refresh` ([ADR 0012](../ADR/0012-refresh-cookie-rotation.md)) | Fixed in `session-guard.ts` |
| Sign-out route | `POST /auth/signOut` | `POST /auth/signout` (lower-case) | Fixed in every page that signs out |
| Domain pages | `rooms-page.tsx`, `getOnlineUser`, `getUserNicknames` | No rooms, presence, or nicknames — this domain is **uploaded video files** | `rooms-page.tsx` and `graphql-operations.ts` deleted; the `/rooms` route removed from `App.tsx`; `rxjs` (only used by the deleted Apollo layer) dropped from `package.json` |
| User actions | `POST /user/:id/ban` \| `/unban` \| `/force-logout` | **None exist** — ROADMAP's default stays "no moderation actions" | All three deleted from `users-page.tsx`, with no backend-side replacement built (that would be new scope, not adaptation) |
| User list query | `GET /user?page&take&sort&sortBy&search&status` | `take`/`skip` only, fixed `createdAt DESC` order, no search/sort/status ([ROADMAP execution order #2](../ROADMAP.md)) | `users-page.tsx` paginates on `take`/`skip`; the search box, sort-toggle headers, and status filter were removed (they would 400 `VALIDATION_FAILED` today — `forbidNonWhitelisted`). ~~Removed~~ **re-added 2026-08-12**: `GetUsersDto` gained `search` (email `ILIKE`) and `sortBy`/`order` (`id`/`email`/`createdAt`, no `role`); the search box and clickable ID/Email/Created headers came back, still no `status` filter (none exists server-side) |
| Audit log | `?action&page&sort&userId&from&to` + `GET /audit-log/export` | `action`, `take`, `skip` only; fixed `createdAt DESC`; **no `/export`**, **no `userId` filter** | `logs-page.tsx` keeps only the action filter + pagination; the CSV export button, date-range filters, and user filter were removed. `userId` ~~missing~~ **added 2026-08-12**: `AuditLogQueryDto` now accepts `userId` (matches actor or target); `logs-page.tsx` itself does not yet read it from the URL — `users-page.tsx`'s new "View all" link navigates to `/logs?userId=…`, and wiring `logs-page.tsx` to consume that query param is left for a follow-up change. `/export` still does not exist |
| Paging model | `page` + `take` | `take` + `skip` (offset) ([ADR 0021](../ADR/0021-list-query-search-filter-sort.md)) | Both list pages compute `skip = (page - 1) * take` and read the `[data, total]` tuple response, not `{ data, total, page, take }` |
| Per-user audit slice | Users page's detail panel fetched `GET /audit-log?userId=…` | No `userId` filter exists | **Dropped**, not approximated — see "Open items" below. ~~Dropped~~ **restored 2026-08-12**: now that `AuditLogQueryDto` has `userId`, the detail panel fetches `GET /audit-log?userId={id}&take=5` (actor or target) for a "Recent activity" section |
| User deletion | `DELETE /user/:id`, no confirmation | `?deleteFiles=true` required when the account owns files, else 409 `USER_HAS_FILES` ([ADR 0020](../ADR/0020-account-deletion-cascade.md)) | `deleteUser()` catches `USER_HAS_FILES`, shows the file count from the response `message`, and re-confirms before retrying with `?deleteFiles=true` |
| Error handling | Ad-hoc status/message checks | Frozen `{ code, message }` contract — branch on `code` ([ADR 0011](../ADR/0011-error-code-contract.md)) | `users-page.tsx` reads `err.response.data.code` via `axios.isAxiosError` for every branch (`AUTH_LAST_SUPERADMIN`, `USER_HAS_FILES`, `USER_FILES_IN_USE`, `FORBIDDEN`) |
| Deploy config | `vercel.json` with a CSP pinned to the Chat Project's Railway host | **No deploy target**; AWS is a Stage 4 roadmap item | Left untouched, as before — out of scope for this pass |

`vercel.json` stays untouched deliberately — there is still no deploy target for this console.

## Two decisions made for this adaptation

1. **Per-user audit slice: dropped, not approximated (2026-08-06); restored 2026-08-12.**
   `GET /audit-log` had no `userId` filter, so the imported panel's "recent logs for this
   user" section could only be approximated by fetching an unfiltered page and filtering
   client-side — which silently drops older entries once a user's real activity falls off
   that page. Dropping the section was exact; approximating it was not. Once the backend
   gained `AuditLogQueryDto.userId` (2026-08-12, closing the [ROADMAP.md](../ROADMAP.md) >
   Unscheduled follow-up this decision recorded), the panel's "Recent activity" section came
   back as an exact `GET /audit-log?userId={id}&take=5` fetch — no client-side filtering.
2. **Role-change UI: a 3-option `<select>`, not the imported binary toggle.** The imported
   promote/demote toggle can only move a row between two states and cannot express
   `superadmin` at all — the exact gap [ADR 0022](../ADR/0022-admin-console-import-from-chat-project.md)
   named as a reason this console exists. The dropdown is still rendered only when the actor
   is superadmin (client-side mirror of `RolesGuard`'s server-side check) and still branches
   on `AUTH_LAST_SUPERADMIN` with its own message.

## Local commands

Run from inside `admin/`.

```bash
pnpm install     # admin/ has its own dependency tree
pnpm dev         # Vite dev server on port 5174
pnpm build       # tsc -b && vite build
pnpm lint        # admin/'s own eslint config
pnpm test        # Vitest (src/**/*.{test,spec}.{ts,tsx})
pnpm e2e         # Playwright — now targets this backend's real routes
pnpm e2e:seed    # Seeds a superadmin; needs e2e/.env (git-ignored)
```

Copy `.env.example` to `.env` and `e2e/.env.example` to `e2e/.env`. Both `.env` files, plus
`node_modules/` and `dist/`, are git-ignored by `admin/.gitignore` — no secrets are tracked.

**One-time backend setup this console needs that `frontend/` does not**: `admin/` calls the
backend cross-origin (`:5174` → `:3000`, no dev proxy, `axios` configured with
`withCredentials: true` for the refresh cookie), so the backend's root `.env` needs
`CORS_ORIGIN=http://localhost:5174` (comma-separate with `frontend/`'s `:5173` origin if
running both). Without it, the browser blocks every request and sign-in fails silently in
the console with no readable error — this is a backend config change, not something this
folder's code can work around, and it is unset by default (`backend/.env.example`).

## Open items (not solved by this pass)

- ~~`GET /audit-log` has no `userId` filter~~ — **resolved 2026-08-12**: `AuditLogQueryDto`
  now accepts `userId`; see "Two decisions" above.
- **`logs-page.tsx` does not yet read a `userId` query param from its own URL** (added
  2026-08-12) — `users-page.tsx`'s detail panel links to `/logs?userId={id}`, but
  `logs-page.tsx` still only filters on `action`. Wiring it to read and apply `userId` is
  left for a follow-up change.
- **`PATCH /file/:id { userId }` file-transfer field has never been justified by any
  decision** (CLAUDE.md > Known Gaps) — unrelated to this console, noted here only because
  nothing in this pass touches it and it should not be assumed settled.
- ~~Which of the two admin surfaces survives~~ — **resolved 2026-08-06**: this console's
  successful adaptation proved the import was not "mostly deletable" (only its chat-domain
  remnant was), so this is now the sole admin surface.
  `frontend/src/features/admin/AdminPage.tsx` was deleted. See
  [ROADMAP.md](../ROADMAP.md) > Stage 5.

## Related decisions

- [ADR 0022](../ADR/0022-admin-console-import-from-chat-project.md) — the import; amends
  ADR 0010's admin-placement clause
- [ADR 0028](../ADR/0028-access-token-role-claim.md) — added the access-token `role` claim
  this console's route guard depends on
- [ADR 0010](../ADR/0010-frontend-split-and-api-surface-freeze.md) — originally placed admin as
  an `/admin` route section inside `frontend/`. That section
  (`frontend/src/features/admin/AdminPage.tsx`) was deleted 2026-08-06 once this console
  proved to be the surface that survives — see that ADR's second amendment note
- [CHAT-REMNANT-REMOVAL-PLAN.md](../CHAT-REMNANT-REMOVAL-PLAN.md) — this folder is a *declared*
  design import (bucket 4), not an unlabelled remnant. That classification holds regardless of
  this adaptation — the remaining code is still provenance-copied, now corrected rather than raw

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
   [ADR 0013](../docs/ADR/0013-rbac-and-audit-log.md) — three tiers (`user`/`admin`/`superadmin`)
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
  [ADR 0022](../docs/ADR/0022-admin-console-import-from-chat-project.md)
- This adaptation is **ROADMAP Stage 5's second row** ("adapt the imported `admin/` console"),
  unblocked by the first row — the access token gained a `role` claim in
  [ADR 0028](../docs/ADR/0028-access-token-role-claim.md) (execution order #3), which this console's
  route guard depends on to gate `/dashboard`, `/users`, and `/logs`.

## Status

| | |
|---|---|
| Provenance | Chat Project admin console, imported 2026-07-30; role-management slice adapted 2026-08-06 |
| Adapted to this API? | **Yes** — login/dashboard/users/logs (see "What was adapted"). `vercel.json`'s dead Chat Project CSP host was fixed 2026-08-13 (see "Provenance cleanup" below); there is still no deploy target |
| Wired into root tooling? | **No** — outside the lint glob, Jest `roots`, `tsconfig.build.json`, `docker-compose.yml`, and CI. This is deliberate (ADR 0022), not a gap |
| Dependencies | Own `package.json` / `node_modules`; **not** a pnpm workspace (same precedent as `frontend/`). `@apollo/client`, `graphql`, and `rxjs` were dropped with the chat-domain deletion |
| Runs today? | Yes, against a real backend on `:3000` — see "Local commands" for the one-time `CORS_ORIGIN` setup this needs (admin runs on its own origin, `:5174`, unlike `frontend/`'s same-origin Vite proxy) |

Root `pnpm lint`, `pnpm test`, and `pnpm test:e2e` cannot reach this folder, so nothing in here
can break the backend pipeline.

## Defects found by a live UI/UX pass (2026-08-24)

Both were found by driving the running console in a real browser, and both are fixed here —
in `admin/` only, with no backend, contract, or schema change.

- **The audit log named the wrong kind of target.** `logs-page.tsx` printed
  `User {targetId}` on every row, but `targetId` is polymorphic: checked against all five
  `auditLogService.log()` call sites, `ROLE_CHANGE`/`USER_DELETE` pass a user id while
  `FILE_DELETE`/`POST_DELETE`/`COMMENT_DELETE` pass a file/post/comment id. A row reading
  "FILE_DELETE … Target: User 313" was about file 313, so following it led to an unrelated
  user. `src/lib/audit.ts` gained `targetLabel(action, targetId)` (next to `actionColor`),
  which maps the action to its noun and prints a bare `#id` for an action it does not know,
  rather than guessing. `dashboard-page.tsx` renders only `actorId` — always a user — and was
  left as it was. **This corrects the display only.** Whether the backend should carry the
  target's type explicitly was left a separate open question — **settled 2026-08-24** by
  [ADR 0045](../docs/ADR/0045-audit-log-target-type.md), which added a `targetType`
  discriminator column. `targetLabel` now reads that field instead of mapping the action, and
  the client-side action -> noun map was deleted; the display fix above stands unchanged.
- **Every table hid its own controls on a narrow screen.** All three wrappers were
  `overflow-hidden`, and `overflow-x-auto` appeared nowhere in `src/` (the whole console has
  two responsive utilities). At a 375px viewport the users table clipped 272px — taking the
  Created, Role, and Actions columns with it, so the role `<select>` and the Delete button,
  the two things an operator comes here to do, could not be reached — and the logs table
  clipped 233px, hiding Detail. The page reported no overflow, so nothing hinted the columns
  existed, and there was no scrollbar to drag. The three wrappers are now `overflow-x-auto`.
  This restores access and nothing more: on a phone these are still wide tables, and a
  layout actually designed for that width remains open
  ([ROADMAP.md](../docs/ROADMAP.md) > 7).

Verified live at 375px and 1280px; `pnpm build`, `pnpm lint` (0 errors), `pnpm test` (19/19),
and `pnpm e2e` (11/11) all pass.

## Provenance cleanup (2026-08-13)

Two cosmetic/dead-config remnants of the Chat Project import, independent of the functional
adaptation below — colors and layout are otherwise untouched:

- `index.html`'s `<title>` was the generic `"Admin Panel"` — now `"Sharenpo Admin"`, with a
  matching `admin/public/favicon.svg` (a plain "S" initials mark) linked from `<head>`.
- `vercel.json`'s CSP `connect-src` still pointed at the Chat Project's live Railway deployment
  (`https://chat-project-production-3b22.up.railway.app`) — unreachable dead config, but wrong if
  ever read as a template. Replaced with `http://localhost:3000` (this backend's local dev
  default; see `BASE_URL` in the root `.env.example`). **This is a placeholder, not a real deploy
  domain** — Stage 4 (production DevOps stack, CLAUDE.md > Known Gaps & Roadmap) has not yet
  decided where this backend is hosted, so `connect-src` needs updating again once that origin
  exists. Vercel stays the intended deploy target for this console (confirmed with the developer);
  no actual deployment has been set up.

## What was adapted

Every row below was *correct* in the Chat Project — each was a defect only relative to this
project, verified against this repository's code on 2026-08-06 (re-verified against 2026-07-30's
findings; one backend change landed in between — see the `FORBIDDEN` row).

| Area | Imported code expected | This project has | Resolution |
|---|---|---|---|
| Role encoding | `{ role: 1 }` (numeric), labels via `Record<number, string>` | `UserRole` **string enum** (`'user' \| 'admin' \| 'superadmin'`) | `auth.store.ts`'s `role` is now `UserRole`; a `ROLE_RANK`/`ROLE_LABEL` lookup (`src/auth/role.ts`, new) replaces every numeric compare |
| Role source | `jwtDecode<{ sub, role }>(accessToken)` | Access-token payload now carries `role` ([ADR 0028](../docs/ADR/0028-access-token-role-claim.md)) | `session-guard.ts`, `login-page.tsx`, `protected-route.tsx` decode `role` as `UserRole \| undefined` and gate on `ROLE_RANK[role] >= ROLE_RANK.admin` |
| Who may assign roles | Any admin sees the role control | `PATCH /user/:id/role` is **superadmin-only**; `updateRole` has no rank ceiling on the target (only refuses the last-superadmin demotion) | `users-page.tsx` renders the role `<select>` only when `myRole === 'superadmin'`, on every row including the actor's own and other superadmins' — matching what the endpoint actually allows |
| Hierarchy invariants | No branch for either | Last-superadmin demotion refused (400 `AUTH_LAST_SUPERADMIN`); any role change ends the target's session (`refreshTokenHash` nulled) | `updateRole()` in `users-page.tsx` branches on the `AUTH_LAST_SUPERADMIN` code for a distinct message; the session-ending side effect needs no client handling (correct as-is) |
| Role labels | `role === 1 ? 'admin' : 'user'` (binary) | Three tiers | Replaced the promote/demote toggle with a 3-option `<select>` (user/admin/superadmin) — see the "role-change UI" decision below |
| Privilege-escalation guard *(found during this pass, not in the 2026-07-30 survey)* | No such check existed anywhere | `PATCH`/`DELETE /user/:id` now refuse (403 `FORBIDDEN`) an admin acting on an equal-or-higher-ranked target — closed the same day as this adaptation | `users-page.tsx` only renders the Delete button when `ROLE_RANK[myRole] > ROLE_RANK[target.role]`, and `deleteUser()` still branches on `FORBIDDEN` defensively (a role can change between page load and click) |
| Audit actions | Colors 6 actions incl. `FORCE_LOGOUT`, `USER_BANNED`, `USER_MUTED`, `USER_UNBAN` | `AUDIT_ACTIONS` is exactly `ROLE_CHANGE`, `USER_DELETE`, `FILE_DELETE`, `POST_DELETE`, `COMMENT_DELETE` | `logs-page.tsx`'s `ACTIONS` list and both pages' `actionColor()` now match exactly |
| Superadmin bootstrap docs | `e2e/.env.example` + `e2e/seed-superadmin.mjs` cited "CLAUDE.md's Role Population Invariants" | No such section anywhere in this repo — the real mechanism is `SUPERADMIN_EMAIL` + `superadmin-seed.service.ts` | Both files' citations corrected; `seed-superadmin.mjs`'s SQL now inserts the string `'superadmin'` (not `role=2, "isAI"=false` — `isAI` doesn't exist on `UserEntity`), and its `.env` search path was fixed to the actual root `.env` (there is no `backend/.env`) |
| Transport | Apollo Client against `/graphql` (`src/api/apollo.ts`, `src/api/graphql-operations.ts`, Apollo hooks in `dashboard-page`/`rooms-page`/`logs-page`) | **REST only — no `/graphql` route** ([ADR 0009](../docs/ADR/0009-rest-only-api-with-swagger.md)) | Both files deleted; `main.tsx`'s `ApolloProvider` removed; `@apollo/client`/`graphql` dropped from `package.json` |
| Refresh route | `POST /auth/token/refreshaccess` | `POST /auth/token/refresh` ([ADR 0012](../docs/ADR/0012-refresh-cookie-rotation.md)) | Fixed in `session-guard.ts` |
| Sign-out route | `POST /auth/signOut` | `POST /auth/signout` (lower-case) | Fixed in every page that signs out |
| Domain pages | `rooms-page.tsx`, `getOnlineUser`, `getUserNicknames` | No rooms, presence, or nicknames — this domain is **uploaded video files** | `rooms-page.tsx` and `graphql-operations.ts` deleted; the `/rooms` route removed from `App.tsx`; `rxjs` (only used by the deleted Apollo layer) dropped from `package.json` |
| User actions | `POST /user/:id/ban` \| `/unban` \| `/force-logout` | **None exist** — ROADMAP's default stays "no moderation actions" | All three deleted from `users-page.tsx`, with no backend-side replacement built (that would be new scope, not adaptation) |
| User list query | `GET /user?page&take&sort&sortBy&search&status` | `take`/`skip` only, fixed `createdAt DESC` order, no search/sort/status ([ROADMAP execution order #2](../docs/ROADMAP.md)) | `users-page.tsx` paginates on `take`/`skip`; the search box, sort-toggle headers, and status filter were removed (they would 400 `VALIDATION_FAILED` today — `forbidNonWhitelisted`). ~~Removed~~ **re-added 2026-08-12**: `GetUsersDto` gained `search` (email `ILIKE`) and `sortBy`/`order` (`id`/`email`/`createdAt`, no `role`); the search box and clickable ID/Email/Created headers came back, still no `status` filter (none exists server-side) |
| Audit log | `?action&page&sort&userId&from&to` + `GET /audit-log/export` | `action`, `take`, `skip` only; fixed `createdAt DESC`; **no `/export`**, **no `userId` filter** (at import time) | `logs-page.tsx` originally kept only the action filter + pagination; the CSV export button, date-range filters, and user filter were removed. `userId` ~~missing~~ **added 2026-08-12**: `AuditLogQueryDto` now accepts `userId`, and `logs-page.tsx` reads it from its own URL (`?userId=`) the same commit — `users-page.tsx`'s "View all" link (`/logs?userId=…`) is a live filter, not a dead one. `userId` matches the actor, **or** the target of a user-targeting action (`targetType = 'user'`) — narrowed 2026-08-24 by [ADR 0045](../docs/ADR/0045-audit-log-target-type.md), which added the `targetType` discriminator; before that it read every polymorphic `targetId` as a user id, so a file/post/comment whose id collided with a user id surfaced as that user's activity. A record targeting a file, post, or comment now matches through the actor side only. CSV export ~~removed~~ **re-added 2026-08-12**, client-side: `/audit-log/export` still does not exist, so `exportCsv()` pages through `GET /audit-log` at the DTO's `take` ceiling (100/page) up to a 1000-row cap and downloads the result |
| Paging model | `page` + `take` | `take` + `skip` (offset) ([ADR 0021](../docs/ADR/0021-list-query-search-filter-sort.md)) | Both list pages compute `skip = (page - 1) * take` and read the `[data, total]` tuple response, not `{ data, total, page, take }` |
| Per-user audit slice | Users page's detail panel fetched `GET /audit-log?userId=…` | No `userId` filter exists | **Dropped**, not approximated — see "Open items" below. ~~Dropped~~ **restored 2026-08-12**: now that `AuditLogQueryDto` has `userId`, the detail panel fetches `GET /audit-log?userId={id}&take=5` for a "Recent activity" section — the actor, or the target of a user-targeting action (`targetType = 'user'`, [ADR 0045](../docs/ADR/0045-audit-log-target-type.md)), so a file/post/comment id colliding with this user's id no longer appears here |
| User deletion | `DELETE /user/:id`, no confirmation | `?deleteFiles=true` required when the account owns files, else 409 `USER_HAS_FILES` ([ADR 0020](../docs/ADR/0020-account-deletion-cascade.md)) | `deleteUser()` catches `USER_HAS_FILES`, shows the file count from the response `message`, and re-confirms before retrying with `?deleteFiles=true` |
| Error handling | Ad-hoc status/message checks | Frozen `{ code, message }` contract — branch on `code` ([ADR 0011](../docs/ADR/0011-error-code-contract.md)) | `users-page.tsx` reads `err.response.data.code` via `axios.isAxiosError` for every branch (`AUTH_LAST_SUPERADMIN`, `USER_HAS_FILES`, `USER_FILES_IN_USE`, `FORBIDDEN`) |
| Deploy config | `vercel.json` with a CSP pinned to the Chat Project's Railway host | **No deploy target**; AWS is a Stage 4 roadmap item | Left untouched, as before — out of scope for this pass |

The row above reflects the 2026-08-06 functional-adaptation pass only; `vercel.json`'s dead CSP
host was fixed separately on 2026-08-13 (see "Provenance cleanup" above) — there is still no
deploy target for this console.

## Two decisions made for this adaptation

1. **Per-user audit slice: dropped, not approximated (2026-08-06); restored 2026-08-12.**
   `GET /audit-log` had no `userId` filter, so the imported panel's "recent logs for this
   user" section could only be approximated by fetching an unfiltered page and filtering
   client-side — which silently drops older entries once a user's real activity falls off
   that page. Dropping the section was exact; approximating it was not. Once the backend
   gained `AuditLogQueryDto.userId` (2026-08-12, closing the [ROADMAP.md](../docs/ROADMAP.md) >
   Unscheduled follow-up this decision recorded), the panel's "Recent activity" section came
   back as an exact `GET /audit-log?userId={id}&take=5` fetch — no client-side filtering.
   The filter's meaning was corrected on 2026-08-24 by [ADR 0045](../docs/ADR/0045-audit-log-target-type.md):
   it had read every `targetId` as a user id, and `targetId` is polymorphic, so the panel
   showed unrelated file/post/comment records whose id happened to equal this user's. It now
   means "actor, or target of a user-targeting action (`targetType = 'user'`)" — the panel
   returns fewer rows, and the ones it dropped were wrong.
2. **Role-change UI: a 3-option `<select>`, not the imported binary toggle.** The imported
   promote/demote toggle can only move a row between two states and cannot express
   `superadmin` at all — the exact gap [ADR 0022](../docs/ADR/0022-admin-console-import-from-chat-project.md)
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
  now accepts `userId`; see "Two decisions" above. **Corrected 2026-08-24**
  ([ADR 0045](../docs/ADR/0045-audit-log-target-type.md)): the filter matched any row whose
  `targetId` equaled the id, but `targetId` is polymorphic — it now matches the actor, or the
  target of a user-targeting action (`targetType = 'user'`). Records targeting a file, post,
  or comment match through the actor side only.
- ~~`logs-page.tsx` does not yet read a `userId` query param from its own URL~~ — **resolved
  2026-08-12, same commit**: it reads `?userId=` via `useSearchParams` and applies it to the
  `GET /audit-log` query; `users-page.tsx`'s "View all" link (`/logs?userId={id}`) is a live
  filter. (The "What was adapted" table's Audit log row previously said this was still open —
  corrected 2026-08-13.)
- ~~No e2e coverage for the 2026-08-12 additions~~ — **resolved 2026-08-13**:
  `admin/e2e/logs.spec.ts` gained a test for the `userId` filter / "View all" link (with its
  clear button) and one for CSV export (downloads the file, asserts the header row and the
  expected data rows); `admin/e2e/users.spec.ts` gained a search-box test and a sortable-header
  test. `pnpm e2e` — 10/10 passing.
- **`PATCH /file/:id { userId }` file-transfer field has never been justified by any
  decision** (CLAUDE.md > Known Gaps) — unrelated to this console, noted here only because
  nothing in this pass touches it and it should not be assumed settled.
- ~~Which of the two admin surfaces survives~~ — **resolved 2026-08-06**: this console's
  successful adaptation proved the import was not "mostly deletable" (only its chat-domain
  remnant was), so this is now the sole admin surface.
  `frontend/src/features/admin/AdminPage.tsx` was deleted. See
  [ROADMAP.md](../docs/ROADMAP.md) > Stage 5.

## Related decisions

- [ADR 0022](../docs/ADR/0022-admin-console-import-from-chat-project.md) — the import; amends
  ADR 0010's admin-placement clause
- [ADR 0028](../docs/ADR/0028-access-token-role-claim.md) — added the access-token `role` claim
  this console's route guard depends on
- [ADR 0010](../docs/ADR/0010-frontend-split-and-api-surface-freeze.md) — originally placed admin as
  an `/admin` route section inside `frontend/`. That section
  (`frontend/src/features/admin/AdminPage.tsx`) was deleted 2026-08-06 once this console
  proved to be the surface that survives — see that ADR's second amendment note
- [CHAT-REMNANT-REMOVAL-PLAN.md](../docs/CHAT-REMNANT-REMOVAL-PLAN.md) — this folder is a *declared*
  design import (bucket 4), not an unlabelled remnant. That classification holds regardless of
  this adaptation — the remaining code is still provenance-copied, now corrected rather than raw

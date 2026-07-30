# ADR 0022: Admin Console Imported from the Chat Project as a Modification Base

- Status: Accepted
- Date: 2026-07-30
- Amends: [ADR 0010](0010-frontend-split-and-api-surface-freeze.md) (admin placement clause only)
- 한국어: [0022-admin-console-import-from-chat-project.ko.md](0022-admin-console-import-from-chat-project.ko.md)

## Context

Two preconditions came together at this point in the project.

**The backend can finally tell an admin apart from a user.** RBAC and the audit log landed
2026-07-25 ([ADR 0013](0013-rbac-and-audit-log.md)): three role tiers, `RolesGuard`/`@Roles`,
an admin-only `GET /user`, a superadmin-only `PATCH /user/:id/role`, and an append-only
`GET /audit-log`. [ADR 0010](0010-frontend-split-and-api-surface-freeze.md) had made the
promotion of admin to its own application conditional on exactly that — "reconsidered only
after RBAC lands and real admin requirements exist" — because a three-way split before roles
existed "would ship an app the backend cannot even distinguish".

**An admin console for this same role model already exists — in a different project.** The
author's other project, the **Chat Project** (NestJS + GraphQL + Redis + Socket.IO), carries a
working, tested admin console built against the same three-tier `user`/`admin`/`superadmin`
design that [ADR 0013](0013-rbac-and-audit-log.md) adopted here (ROADMAP already records that
design as "Chat-project style"). Most of what that console contains is **domain-independent
scaffolding** — the part of an admin app that looks the same whether it administers chat rooms
or uploaded files:

| Imported asset | What it is |
|---|---|
| `src/App.tsx`, `src/main.tsx` | React Router 7 shell, route table, entry point |
| `src/components/protected-route.tsx` | Route guard: silent-refresh bootstrap + role-rank gate |
| `src/store/auth.store.ts` | Zustand auth store (access token in memory, never persisted) |
| `src/auth/session-guard.ts` | Single-flight silent refresh + multi-tab session-conflict detection |
| `src/api/axios.ts` | Bearer request interceptor + 401-once-retry response interceptor |
| `e2e/`, `playwright.config.ts` | Playwright harness plus a superadmin seeding script |
| `src/test/setup.ts`, `vite.config.ts`, `eslint.config.js`, `tsconfig*.json`, Tailwind | Vitest/jsdom, build, lint, and styling configuration |

**The cost being optimized here is explicit, and it is economic: LLM token spend.** Generating
that scaffolding prompt-by-prompt in this repository would spend a large number of tokens
producing code whose shape is already settled and already proven elsewhere. Copying the folder
in and then editing it spends tokens only on the delta — the parts that are genuinely specific
to this project's API. That is the entire reason this ADR exists rather than a "build the admin
console" task.

This ADR records the *import and its provenance*. It deliberately does **not** adapt the code.

## Decision

**The Chat Project's admin console is imported wholesale into this repository as the top-level
`admin/` folder, committed unmodified, as a declared modification base — not as working code.**

1. **Provenance is documented, never disguised.** `admin/` is a copy of another project's
   application. Until a dedicated adaptation task rewrites it, every file in it describes the
   **Chat Project's** API and domain, not this one. `admin/README.md` states this at the folder
   itself, so a reader who lands there without reading ADRs cannot mistake it for this
   project's working admin client.
2. **Committed as-is, adapted later.** This change adds the folder and the documentation around
   it, and changes not one line of the imported source. Adaptation is its own dedicated task
   under [CLAUDE.md](../CLAUDE.md) > Scope Discipline, with the modification backlog below as
   its brief. Keeping the import pristine in one commit is what makes that later diff readable:
   the adaptation shows up as "Chat → Upload Board", not tangled with the import itself.
3. **Wired into nothing.** `admin/` is outside every piece of root tooling — the lint glob
   (`{backend,apps,libs,test}/**/*.ts`), Jest `roots` (`["backend"]`), `tsconfig.build.json`,
   `docker-compose.yml`, and the CI workflow. It carries its own `package.json`, its own
   `node_modules`, and its own eslint/vitest/playwright configuration. This is **not** a
   pnpm-workspace monorepo — the same non-workspace precedent `frontend/` set in
   [ADR 0010](0010-frontend-split-and-api-surface-freeze.md). `pnpm lint`, `pnpm test`, and
   `pnpm test:e2e` at the root are therefore unaffected by anything inside `admin/`, including
   code that would fail this repo's rules.
4. **This amends [ADR 0010](0010-frontend-split-and-api-surface-freeze.md)'s admin-placement
   clause**, and nothing else in it. Admin now begins life as a **separate application at
   `admin/`** rather than as an `/admin` route section inside `frontend/`. The API surface
   freeze, the RBAC deferral, the in-repo (non-workspace) structure, and the static-serving
   constraint all stand untouched.
5. **Two admin surfaces coexist for now, and that is temporary.**
   `frontend/src/features/admin/AdminPage.tsx` — ADR 0010's route section — still exists.
   Which of the two survives is an **open decision**, recorded in ROADMAP > Unscheduled, not
   settled here: settling it requires the adaptation work to reveal how much of the imported
   console is actually worth keeping.
6. **This is not a chat remnant in the [removal plan](../CHAT-REMNANT-REMOVAL-PLAN.md)'s
   sense — it is bucket 4 (intentional design reference), under a stricter condition.** That
   plan's bucket 4 permits citing the chat project as a design source "provided it is phrased
   as a reference to another project, never as a description of this repo's current state".
   `admin/` is *code*, not a prose citation, so the condition is carried by this ADR and by
   `admin/README.md` instead of by a sentence's phrasing. Both must keep saying plainly that
   the folder targets the Chat Project's API. The plan's re-verification trigger — "content is
   pasted in from another project" — fired for this import and is recorded there.

## Why import rather than write it here

| Criterion | A. Import Chat admin, then modify (**chosen**) | B. Build `/admin` section in `frontend/` from scratch | C. Build a new standalone admin app from scratch |
|---|---|---|---|
| Token cost | **Lowest** — spend only on the API delta | High — regenerate router, guard, store, refresh, e2e harness | Highest — all of B plus a second app's tooling |
| Scaffolding reuse | Full (router, guard, auth store, single-flight refresh, Playwright harness) | Partial — reuses `frontend/`'s existing auth plumbing | None |
| Risk of code targeting the wrong API | **High — the defining cost of this option** | None | None |
| Fit with ADR 0010 as written | Requires the amendment above | Exact fit | Requires the amendment above |
| Review burden | Concentrated in one later adaptation task | Spread across normal review | Spread across normal review |

Option A wins on the criterion the author is optimizing (token cost) and loses on exactly one:
imported code that targets the wrong API. That risk is not waved away — it is converted into a
written, verified backlog (next section) and quarantined by decision 3 (wired into nothing), so
the failure mode is "this folder does not run yet", never "the backend behaves oddly".

## Modification backlog — what must change before `admin/` runs

Verified against this repository's code on 2026-07-30, not inferred. Each row is a defect
*relative to this project*; in the Chat Project every one of them was correct.

| Area | Imported code expects (Chat Project) | This project actually has | Required change |
|---|---|---|---|
| Transport | Apollo Client against `${VITE_API_URL}/graphql` — `src/api/apollo.ts`, `src/api/graphql-operations.ts`, and the Apollo `useQuery`/`useMutation` calls in `dashboard-page`, `rooms-page`, `logs-page` | **REST only; no `/graphql` route exists** ([ADR 0009](0009-rest-only-api-with-swagger.md)) | Delete the Apollo layer; every read goes through `src/api/axios.ts` |
| Refresh route | `POST /auth/token/refreshaccess` (`src/auth/session-guard.ts`) | `POST /auth/token/refresh` ([ADR 0012](0012-refresh-cookie-rotation.md), frozen by ADR 0010) | Rename the path |
| Sign-out route | `POST /auth/signOut` (all four pages) | `POST /auth/signout` (lower-case) | Fix the casing |
| Role representation | `role: number`, gate is `(role ?? -1) < 1` (`auth.store.ts`, `protected-route.tsx`) | `UserRole` **string enum** + `ROLE_RANK` map ([ADR 0013](0013-rbac-and-audit-log.md)) | Retype to the string enum and compare through a rank map |
| Role source | `jwtDecode<{ sub, role }>(accessToken)` — reads `role` from the access token | Access-token payload is `{ sub, type }` — **there is no `role` claim** (`auth.service.ts` `issueToken`) | `role` must be fetched (e.g. `GET /user/:id`), not decoded; until then the guard sees `undefined` and rejects every admin |
| Domain pages | `rooms-page.tsx` (`getAllRooms`, `deleteRoom`), plus `getOnlineUser` and `getUserNicknames` on the dashboard | No rooms, no presence, no nicknames — this domain is **uploaded video files** | Delete the rooms page and presence/nickname widgets; replace with a files surface |
| User admin endpoints | `POST /user/:id/ban`, `/unban`, `/force-logout`; `GET /user?humanOnly`, `?status` | **None of these exist.** The user surface is `GET /user`, `GET /user/:id`, `PATCH /user/:id`, `PATCH /user/:id/role`, `DELETE /user/:id` | Remove the unbacked actions, or specify them as backend work with their own ADR |
| User list query | `GET /user?page&take&sort&sortBy&search&status` | `findAll()` binds **no `@Query()` at all** — it returns `findAndCount()` over every user, and unknown query params are silently ignored rather than rejected | Drop the params, or pursue pagination for `GET /user` as backend work |
| Audit log | `GET /audit-log?action&page&sort&userId&from&to` and `GET /audit-log/export` (blob/CSV) | `AuditLogQueryDto` accepts `action`, `take`, `skip` only; **no `/export` route** | Reduce to the supported filters; drop the export button or specify it as backend work |
| List paging model | `page` + `take` | `take` + `skip` (offset), plus `search`/`sortBy`/`order`/`creatorId` on `GET /file` ([ADR 0021](0021-list-query-search-filter-sort.md)) | Convert page numbers to offsets |
| Deletion contract | `DELETE /user/:id` with no confirmation | `?deleteFiles=true` is required for an account that owns files; otherwise **409 `USER_HAS_FILES`** ([ADR 0020](0020-account-deletion-cascade.md)) | Add the confirmation dialog and the 409 branch |
| Error handling | Ad-hoc status/message checks | Frozen `{ code, message }` `ErrorBody` contract ([ADR 0011](0011-error-code-contract.md)) | Branch on `code`, not on message text |
| Deploy config | `vercel.json` whose CSP pins `connect-src` to the Chat Project's Railway host | **No deploy target**; AWS container deploy is a Stage 4 roadmap item | Rewrite or delete before any deploy |
| Session key | `sessionStorage` key `admin:sessionUserId` | Coexists with `frontend/`'s own session-guard key on the same origin in dev | Verify the keys cannot collide once both apps run |

## Consequences

- **The repository now tracks committed application code that does not work against this
  backend.** That is the deliberate, stated trade of this ADR, and it is why the provenance
  documentation is part of the same commit rather than a follow-up. The mitigation is
  containment (decision 3), not correctness: nothing in this repo builds, tests, lints, or
  serves `admin/`, so a broken folder cannot break a green pipeline.
- **CI, lint, and both test suites are provably unaffected.** `lint`/`lint:ci` glob
  `{backend,apps,libs,test}/**/*.ts`, Jest `roots` is `["backend"]`, and the workflow runs
  only those — none of them can reach `admin/`.
- **`admin/vercel.json` ships a live chat-project remnant**: a CSP `connect-src` pointing at
  `chat-project-production-3b22.up.railway.app`. It is committed **unmodified on purpose**, so
  the adaptation task diffs against the original rather than against a half-edited file. It is
  listed in the backlog above and must be rewritten or deleted before `admin/` is deployed
  anywhere — which today is nowhere, since this project has no deploy target.
- **Importing Apollo code does not reopen [ADR 0009](0009-rest-only-api-with-swagger.md).**
  Nothing in this repository serves GraphQL, and no backend change here adds it. The Apollo
  files are the *first entries on the delete pile*, not a transport decision — REST-only stands.
- **`admin/`'s dependencies are not this project's dependencies.** `@apollo/client`, `graphql`,
  `rxjs`, `zustand`, `react-hook-form`, `jwt-decode` et al. live in `admin/package.json` and
  `admin/node_modules`, absent from the root `pnpm-lock.yaml`. Root `pnpm audit` does not see
  them, so `pnpm audit --prod` staying clean says nothing about `admin/`. Any of them that
  survives adaptation goes through the dependency review in Scope Discipline (license, CVEs)
  at that point.
- **No secrets are committed.** `admin/.gitignore` already ignores `node_modules`, `dist`,
  `.env`, and `.env.local`, which covers `admin/.env`, `admin/.env.local`, and `admin/e2e/.env`
  (verified with `git check-ignore` before committing). Only the `.env.example` templates are
  tracked.
- **`.dockerignore` gains `admin`**, next to the existing `frontend` and `test` entries. Without
  it, the new folder would silently enter the backend image's build context, which is the same
  reason `frontend` is listed there.
- **Two admin surfaces exist simultaneously**, and the duplication is visible rather than
  hidden: ADR 0010's `frontend/src/features/admin/AdminPage.tsx` and this `admin/` app.
  Resolving it is tracked in ROADMAP > Unscheduled.
- **The `.ko.md` sibling requirement extends into `admin/`.** `admin/README.md` is a tracked
  document, so `admin/README.ko.md` accompanies it, per
  [CLAUDE.md](../CLAUDE.md) > Documentation Convention.
- **The chat-remnant audit's blind spot is now on the record.** That plan's grep sets cover
  `*.md`, `ADR/`, and `.env.example` only — documentation. This import puts chat-project terms
  (`apollo`, `graphql-operations`, `errorLink`, `zustand`, `session-guard`, `protected-route`,
  room/nickname identifiers) into **tracked source code**, outside every existing grep. The
  plan is updated in the same change to say so.

## Alternatives rejected

- **Build the `/admin` route section inside `frontend/` from scratch** (option B above, and
  what ADR 0010 originally specified) — the cleanest option on every axis except the one being
  optimized. It regenerates a router, a route guard, an auth store, a single-flight refresh
  guard, and a Playwright harness that already exist in working form, at full token cost.
  Rejected for that reason and only that reason; if adaptation proves the imported console is
  mostly deletable, this becomes the better path and the open decision in ROADMAP flips to it.
- **Import only the domain-independent files** (auth store, session guard, protected route,
  configs) and leave the pages behind — a smaller, less misleading diff. Rejected as
  *false economy in the literal sense*: choosing which files are domain-independent is itself
  the adaptation analysis, done up front without the benefit of having the whole console to
  read, and the discarded pages are also the working examples of how the kept pieces are used.
  A pristine import plus a written backlog keeps that judgment for the task that can make it
  properly.
- **Adapt during the import — one commit that lands a working admin app** — no window in which
  the repo holds non-working code. Rejected on two counts: it collapses "where this came from"
  and "what we changed" into one unreadable diff, and adaptation touches every row of a
  13-row backlog, several of which (the missing `role` claim, the absent ban/force-logout
  endpoints, `GET /user` pagination) are **backend** questions needing their own decisions
  rather than client edits.
- **Keep `admin/` untracked on disk** — no chat-project code in git history at all. Rejected:
  an untracked folder is invisible to review, absent from every future audit, and disappears
  with the working copy. It also makes the token-economy decision itself unrecorded, which is
  precisely the thing worth documenting here.
- **Copy the code with the provenance left unstated** — smaller documentation footprint.
  Rejected outright. An undocumented copy of another project's app is the exact failure the
  [chat-remnant removal plan](../CHAT-REMNANT-REMOVAL-PLAN.md) was written after: `CLAUDE.md`
  itself entered this repo that way, and the cleanup cost far more than the import saved.

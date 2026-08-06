# ADR 0022: Admin Console Imported from the Chat Project as a Modification Base

- Status: Accepted
- Date: 2026-07-30
- Amends: [ADR 0010](0010-frontend-split-and-api-surface-freeze.md) (admin placement clause only)
- Relates to: [ADR 0013](0013-rbac-and-audit-log.md) (this is the operator surface for that role hierarchy)
- 한국어: [0022-admin-console-import-from-chat-project.ko.md](0022-admin-console-import-from-chat-project.ko.md)

## Context

Two preconditions came together at this point in the project.

**RBAC shipped the role hierarchy but no way to operate it.** RBAC and the audit log landed
2026-07-25 ([ADR 0013](0013-rbac-and-audit-log.md)): three role tiers with a `ROLE_RANK`
ordering, `RolesGuard`/`@Roles`, an admin-only `GET /user`, a superadmin-only
`PATCH /user/:id/role`, and an append-only `GET /audit-log`. That ADR closed by stating the
gap in its own words — "the role system is ready for the frontend `/admin` section; admin
promotion to a dedicated app remains an ADR 0010 future decision". This ADR is that decision.

What "no way to operate it" concretely means today, verified in the code:

| Role-hierarchy capability | Backend mechanism | Operator surface |
|---|---|---|
| Bootstrap the first superadmin | `SUPERADMIN_EMAIL` + `superadmin-seed.service.ts`, promoted on boot — the **only** path, since no request can create one | Boot-time env var only |
| Promote / demote a user | `PATCH /user/:id/role`, superadmin-only, SERIALIZABLE tx with a row lock | **None** — raw HTTP or Swagger `/doc` |
| See who holds which role | `GET /user`, admin-only | **None** — unpaginated JSON |
| Know a demotion took effect | `updateRole` nulls `refreshTokenHash`, ending the target's session immediately | **None** — invisible to the operator |
| Be stopped from locking the role system | Refuses to demote the last superadmin — 400 `AUTH_LAST_SUPERADMIN` | **None** — the invariant is discovered by hitting it |
| Audit who changed whose role | `ROLE_CHANGE` rows in the append-only audit log, written after the primary commit | **None** — `GET /audit-log` has no viewer |

Every row's right-hand column is the actual requirement behind this import. Managing a
privilege hierarchy through hand-assembled `PATCH` calls is not merely inconvenient: the two
invariants that protect the hierarchy (last-superadmin refusal, session termination on demotion)
are exactly the ones an operator cannot see without a surface that surfaces them.
[ADR 0010](0010-frontend-split-and-api-surface-freeze.md) had made promoting admin to its own
application conditional on precisely this — "reconsidered only after RBAC lands **and real
admin requirements exist**" — because a three-way split before roles existed "would ship an app
the backend cannot even distinguish". Both halves of that condition are now met.

**A console for this same role hierarchy already exists — in a different project.** The
author's other project, the **Chat Project** (NestJS + GraphQL + Redis + Socket.IO), carries a
working, tested admin console built against the same three-tier `user`/`admin`/`superadmin`
design that [ADR 0013](0013-rbac-and-audit-log.md) adopted here — indeed ROADMAP records this
project's RBAC design as "Chat-project style", so the console was written for the very hierarchy
model the table above describes. That is the decisive point: this is not generic scaffolding
that happens to be reusable, it is **a role-hierarchy management console for a hierarchy this
project already implements**. Its users page is built around a role column, a role-assignment
action, a per-user detail panel, and a per-user slice of the audit log — one control per row of
the gap table above. Alongside that it carries **domain-independent scaffolding** — the part of
an admin app that looks the same whether it administers chat rooms or uploaded files:

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

This ADR records the *import, its two purposes, and its provenance*. It deliberately does
**not** adapt the code.

## Decision

**The Chat Project's admin console is imported wholesale into this repository as the top-level
`admin/` folder, committed unmodified, as a declared modification base — not as working code.**

**Two purposes are stated, and both are load-bearing.** Either alone would have been a weaker
case; together they select this specific import over the alternatives:

1. **User privilege-hierarchy management** — supply the operator surface that
   [ADR 0013](0013-rbac-and-audit-log.md)'s RBAC shipped without: viewing who holds which role,
   promoting and demoting through `PATCH /user/:id/role`, and reading the `ROLE_CHANGE` audit
   trail. This is the *requirement*; it is why an admin console is wanted at all.
2. **Token economy** — satisfy that requirement by importing a console already written for the
   same three-tier hierarchy instead of regenerating one prompt-by-prompt. This is the *method*;
   it is why the console arrives as a copy rather than as new code.

1. **Provenance is documented, never disguised.** `admin/` is a copy of another project's
   application. Until a dedicated adaptation task rewrites it, every file in it describes the
   **Chat Project's** API and domain, not this one. `admin/README.md` states this at the folder
   itself, so a reader who lands there without reading ADRs cannot mistake it for this
   project's working admin client.
2. **Committed as-is, adapted later.** This change adds the folder and the documentation around
   it, and changes not one line of the imported source. Adaptation is its own dedicated task
   under [CLAUDE.md](../CLAUDE.md) > Scope Discipline, with the modification backlog below as
   its brief. **Scheduled as ROADMAP Stage 5 (operational surface — admin console), appended
   2026-07-30 by this ADR** — the 11-axis review had scheduled no stage for the admin surface
   even though ADR 0010 decided its placement, so the work was a decision with no home in the
   plan. Stage 5's first row is a **backend** decision that blocks the rest (how a client learns
   its own role); its number is not dependency order — it does not depend on Stage 4. Keeping the import pristine in one commit is what makes that later diff readable:
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
   console is actually worth keeping. *(Resolved 2026-08-06 — see the note at the end of this
   ADR: `admin/` survives, `AdminPage.tsx` was deleted.)*
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
| Role-hierarchy surface | **Already written for the same 3-tier model** — role column, assignment control, audit slice | Designed from scratch against ADR 0013 | Designed from scratch against ADR 0013 |
| Scaffolding reuse | Full (router, guard, auth store, single-flight refresh, Playwright harness) | Partial — reuses `frontend/`'s existing auth plumbing | None |
| Risk of code targeting the wrong API | **High — the defining cost of this option** | None | None |
| Fit with ADR 0010 as written | Requires the amendment above | Exact fit | Requires the amendment above |
| Review burden | Concentrated in one later adaptation task | Spread across normal review | Spread across normal review |

Option A wins on both stated purposes at once — it is the cheapest in tokens *and* the only
option that starts from a console already built for this role hierarchy — and loses on exactly
one criterion: imported code that targets the wrong API. That risk is not waved away — it is
converted into a written, verified backlog (next section) and quarantined by decision 3 (wired
into nothing), so the failure mode is "this folder does not run yet", never "the backend behaves
oddly".

## The aligned subset — role-hierarchy management is where adaptation starts

Not all of the import is equally wrong here. The **role-management slice already targets routes
this API actually has**, which is the direct consequence of both projects implementing the same
hierarchy. Verified against `backend/` on 2026-07-30:

| Imported call | This project's route | Status |
|---|---|---|
| `api.patch('/user/:id/role', { role })` | `PATCH /user/:id/role` — superadmin-only ([ADR 0013](0013-rbac-and-audit-log.md)) | **Route matches**; the body encoding does not (see backlog) |
| `api.get('/user', …)` | `GET /user` — admin-only | **Route matches**; query params are ignored, response is unpaginated |
| `api.get('/user/:id')` | `GET /user/:id` | **Route matches**; `nickname`/`status`/`bannedUntil` fields do not exist here |
| `api.delete('/user/:id')` | `DELETE /user/:id` ([ADR 0020](0020-account-deletion-cascade.md)) | **Route matches**; missing the `?deleteFiles=true` confirmation |
| `api.get('/audit-log', …)` | `GET /audit-log` — admin-only, append-only | **Route matches**; filter set differs, `/export` does not exist |
| `api.post('/auth/signin', …)` (Basic) | `POST /auth/signin` — Basic token ([ADR 0001](0001-basic-token-authentication.md)) | **Matches** — the canonical signin path |
| Role ranks `0 / 1 / 2` (`ROLE_LABEL`) | `ROLE_RANK` = `user: 0, admin: 1, superadmin: 2` | **Ranks are identical** — the hierarchy model transfers unchanged |

Contrast that with `rooms-page.tsx`, the presence/nickname widgets, and the Apollo layer, which
have no counterpart here at all. The practical consequence for sequencing: **adaptation starts
with the role-management slice**, where the work is route-level correction rather than
redesign, and the chat-domain pages are deletions rather than rewrites. That ordering is why
importing the whole console was worth more than importing the scaffolding alone.

The hierarchy *model* transfers; its *encoding* and its *guard rules* do not. Those are the
first four rows of the backlog below.

## Modification backlog — what must change before `admin/` runs

Verified against this repository's code on 2026-07-30, not inferred. Each row is a defect
*relative to this project*; in the Chat Project every one of them was correct.

| Area | Imported code expects (Chat Project) | This project actually has | Required change |
|---|---|---|---|
| Transport | Apollo Client against `${VITE_API_URL}/graphql` — `src/api/apollo.ts`, `src/api/graphql-operations.ts`, and the Apollo `useQuery`/`useMutation` calls in `dashboard-page`, `rooms-page`, `logs-page` | **REST only; no `/graphql` route exists** ([ADR 0009](0009-rest-only-api-with-swagger.md)) | Delete the Apollo layer; every read goes through `src/api/axios.ts` |
| Refresh route | `POST /auth/token/refreshaccess` (`src/auth/session-guard.ts`) | `POST /auth/token/refresh` ([ADR 0012](0012-refresh-cookie-rotation.md), frozen by ADR 0010) | Rename the path |
| Sign-out route | `POST /auth/signOut` (all four pages) | `POST /auth/signout` (lower-case) | Fix the casing |
| Role encoding on the wire | `role: number`; sends `{ role: 1 }` and labels via `ROLE_LABEL: Record<number, string>` | `UserRole` **string enum**; `UpdateRoleDto` validates `@IsEnum(UserRole)` | Send `'admin'`, not `1` — a numeric body is rejected at the boundary as 400 `VALIDATION_FAILED`. The **ranks are already right** (0/1/2 matches `ROLE_RANK`); only the encoding is wrong |
| Role source | `jwtDecode<{ sub, role }>(accessToken)` — reads `role` from the access token | Access-token payload is `{ sub, type }` — **there is no `role` claim** (`auth.service.ts` `issueToken`) | `role` must be fetched (e.g. `GET /user/:id`), not decoded; until then the guard sees `undefined` and rejects every admin. **A backend question first**: whether the client learns its role from a request or from a new claim is a decision, not a client edit |
| Who may assign roles | Any signed-in admin sees the role control; no superadmin gate in the UI | `PATCH /user/:id/role` is **superadmin-only** — `RolesGuard` throws 403 `FORBIDDEN` ("Insufficient role.") for a mere admin | Gate the control on `superadmin`, and handle 403 rather than showing an action that cannot succeed |
| Hierarchy-protecting invariants | No branch for either | Demoting the **last superadmin** is refused with 400 `AUTH_LAST_SUPERADMIN`; **any** role change nulls `refreshTokenHash`, ending the target's session at once | Surface both: a distinct message for the last-superadmin refusal, and a warning that a role change signs the target out |
| Role-change confirmation copy | `role === 1 ? 'admin' : 'user'` — cannot express the third tier | Three tiers, and `superadmin` is assignable | Derive the label from the enum so promotion to `superadmin` is not silently mislabelled |
| Audit action vocabulary | Colors `ROLE_CHANGE`, `USER_DELETE`, `FORCE_LOGOUT`, `USER_BANNED`, `USER_MUTED`, `USER_UNBAN` | `AUDIT_ACTIONS` is exactly `ROLE_CHANGE`, `USER_DELETE`, `FILE_DELETE` | Keep the two that overlap, add `FILE_DELETE`, drop the four moderation actions this project never emits |
| Superadmin bootstrap docs | `e2e/.env.example` and `e2e/seed-superadmin.mjs` cite "CLAUDE.md's **Role Population Invariants**" | **No such section exists** in this repo's `CLAUDE.md` — it is the Chat Project's section name. The real mechanism is `SUPERADMIN_EMAIL` + `superadmin-seed.service.ts`, promoted on boot | Repoint both references at `SUPERADMIN_EMAIL` / [ADR 0013](0013-rbac-and-audit-log.md). The *claim* they make ("no in-app flow can create a superadmin") is **true here too** — only the citation is wrong |
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
  Resolving it is tracked in ROADMAP > Unscheduled. *(Resolved 2026-08-06 — see the note at
  the end of this ADR.)*
- **The `.ko.md` sibling requirement extends into `admin/`.** `admin/README.md` is a tracked
  document, so `admin/README.ko.md` accompanies it, per
  [CLAUDE.md](../CLAUDE.md) > Documentation Convention.
- **[ADR 0013](0013-rbac-and-audit-log.md)'s closing gap is now assigned, not closed.** That ADR
  ended with the role system "ready for the frontend `/admin` section" and the dedicated-app
  question deferred to ADR 0010. This ADR answers the question (a dedicated app at `admin/`) and
  names the owner of the surface, but **the hierarchy is still not operable through a UI** until
  adaptation lands. Until then, `PATCH /user/:id/role` remains reachable only through Swagger or
  a raw request, exactly as before.
- **The imported console's `superadmin` bootstrap notes cite a `CLAUDE.md` section that does not
  exist here.** `admin/e2e/.env.example` and `admin/e2e/seed-superadmin.mjs` both point at
  "CLAUDE.md's Role Population Invariants" — a Chat Project section name. The *claim* they carry
  ("no in-app flow can create a superadmin") holds in this project too, via `SUPERADMIN_EMAIL`
  and `superadmin-seed.service.ts`; only the citation is wrong. Left uncorrected with the rest
  of the import, and listed in the backlog, so a reader hunting that section learns from this
  ADR why they will not find it.
- **The role-management slice is the sequencing lever.** Because it is the only part whose routes
  already match, it is both the cheapest first adaptation and the part that delivers the stated
  privilege-hierarchy purpose. A future task that starts anywhere else spends effort without
  reaching the requirement that motivated the import.
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
  backlog, several of which (the missing `role` claim, the absent ban/force-logout
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

> **Note added 2026-08-05** — two rows of the modification backlog above are now resolved.
> **`GET /user` pagination** landed 2026-08-05 as ROADMAP execution order #2 (pulled forward
> from Stage 5, no new ADR — it reuses the [ADR 0021](0021-list-query-search-filter-sort.md)
> read-layer pattern via a new `GetUsersDto`). **Role source** — the "backend question first"
> this ADR flagged — is answered by [ADR 0028](0028-access-token-role-claim.md): the access
> token now carries an optional `role` claim, so the imported console's
> `jwtDecode<{ sub, role }>(accessToken)` assumption holds against this API. Both were Stage 5
> blockers; adapting the console itself (this ADR's backlog, still unstarted) can now proceed.

> **Note added 2026-08-06** — the console's role-management slice (login, dashboard, users,
> audit log) was adapted against this backend's real routes, closing the modification backlog
> above (full defect-by-defect record: `admin/README.md` > "What was adapted"). That answered
> the question Decision 5 and Consequences left open — **"which admin surface survives"**: the
> import turned out *not* to be "mostly deletable" (only the chat-domain remnant — Apollo,
> rooms, ban/force-logout — was deletable; the role-management substance, the entire reason
> for this import, adapted cleanly), so `admin/` is now the sole admin surface.
> `frontend/src/features/admin/AdminPage.tsx` — a 17-line stub with no backend calls, still
> exactly what it was when [ADR 0010](0010-frontend-split-and-api-surface-freeze.md) reserved
> it — was deleted rather than built out, closing Stage 5's last open row (ROADMAP.md > Stage
> 5). This further amends ADR 0010's admin-placement clause: admin is no longer a route section
> inside `frontend/` at all, not even a reserved one.

# Chat-Project Remnant Removal Plan

> 한국어 버전: [CHAT-REMNANT-REMOVAL-PLAN.ko.md](CHAT-REMNANT-REMOVAL-PLAN.ko.md)

**Status: Mostly closed** — audit executed 2026-07-22; the git-history decision (the
plan's item 1) was made 2026-09-07. What's left is item 2, the re-verification trigger —
fired four times manually so far but not yet automated, so not "closed" by the plan's
own Completion Criteria — see [Remaining Work](#remaining-work-pending).

## Background

`CLAUDE.md` originally entered this repository as a copy from a different project — a
real-time one-to-one chat application (NestJS + GraphQL + Redis + Socket.IO monorepo).
It was rewritten for this repo on 2026-07-22 (commit `f3fff1c`). This plan verifies
that no chat-project references survive in **any** tracked document, and defines the
procedure that keeps them from re-entering.

## Scope

All tracked documentation as of 2026-07-22:

| Group | Files |
|---|---|
| Root docs | `CLAUDE.md`, `README.md`(.ko), `ARCHITECTURE.md`(.ko), `CHANGELOG.md`(.ko), `CONTRIBUTING.md`(.ko), `ROADMAP.md`(.ko) |
| ADR set | `ADR/0001`–`ADR/0009` + `ADR/README.md` (EN/KO pairs, 20 files) |
| Templates | `.env.example` |
| Out-of-repo | Claude Code memory files (`project-principles.md`, `MEMORY.md`) |

Generated artifacts (`coverage/`, `dist/`, `node_modules/`) are excluded — they are
rebuilt from clean sources.

## Method

Two search-term sets, re-runnable at any time from the repo root:

```bash
# Set A — chat-project domain terms
grep -rniE "chat|redis|graphql|socket|pubsub|monorepo|railway|vercel|zustand|apollo|gemini|moderation|sendMessage|receiveMessage|resolver|gateway|subscription|frontend/|backend/|admin/|graphql-ws|ioredis|sentry|bullmq|session-guard|forceLogout|RoomEntity|ChatEntity|superadmin" \
  --include="*.md" *.md ADR/ .env.example

# Set B — chat-project code identifiers
grep -rniE "RbacGuard|GqlTransaction|QueryRunnerDecorator|RateLimitGuard|kickPrevious|AiService|AuditLog|MODERATION_|user_cache|SessionCache|EntityBase|schema\.gql|pnpm --filter|graphql-operations|errorLink|wsLink|reconnectSocket|protected-route|chat-page|DOMpurify|winston" \
  --include="*.md" *.md ADR/ .env.example
```

Every hit is classified into one of four buckets:

1. **Remnant** — describes the chat project's stack/structure as if it were this
   repo's → **remove**.
2. **Deliberate negation** — a guardrail that names the rejected technology
   ("Never suggest GraphQL/WebSocket/gRPC", "no monorepo", "no winston") → **keep**.
3. **This repo's own feature** — a term that now legitimately belongs here
   (e.g. `CORS_ORIGIN` since commit `0549ca4`) → **keep**.
4. **Intentional design reference** — explicitly *citing* the chat project as a
   design source (e.g. ROADMAP's RBAC "Chat-project style" three-tier design) →
   **keep**, provided it is phrased as a reference to another project, never as a
   description of this repo's current state.

## Audit Result (2026-07-22)

**Remnants found: 0.** All hits fell into buckets 2 and 3:

| Location | Hit | Bucket | Action |
|---|---|---|---|
| `CLAUDE.md` (API Layer) | "Never suggest: GraphQL, WebSocket, gRPC" | Negation | Keep |
| `CLAUDE.md` (Project Overview) | "No frontend, no monorepo, no deployment pipeline" | Negation | Keep |
| `CLAUDE.md` / `ARCHITECTURE.md`(.ko) | "no winston, no Nest Logger" | Negation | Keep |
| `ADR/0009`(.ko), `ROADMAP.md`(.ko) Non-Goals | GraphQL/WebSocket/gRPC rejection rationale | Negation | Keep |
| `README.md`(.ko), `ADR/0008`(.ko), `CHANGELOG.md`(.ko), `ROADMAP.md`(.ko) | `CORS_ORIGIN` | Own feature | Keep |
| `CHANGELOG.ko.md`, `CONTRIBUTING.ko.md` | "메시지" (as in 커밋 메시지 / commit message) | False positive | Keep |
| `ROADMAP.md`(.ko) RBAC item | "Chat-project style" three-tier design (`user`/`admin`/`superadmin`) | Design reference | Keep |
| Memory files (out-of-repo) | none | — | Verified clean |

The removal phase completed implicitly with the `f3fff1c` CLAUDE.md rewrite; the
2026-07-22 documentation set (`09d04a8`) was authored natively for this repo and
carried nothing over.

## Trigger Fired — `admin/` Import (2026-07-30)

The re-verification trigger below ("content is pasted in from another project") fired for the
first time. The Chat Project's admin console was imported wholesale as the top-level `admin/`
folder ([ADR 0022](ADR/0022-admin-console-import-from-chat-project.md)) to save LLM tokens on
scaffolding that already existed there.

**Classification: bucket 4 (intentional design reference) — not a remnant.** The import is
declared, dated, and attributed in two places that ship with it: ADR 0022 and
`admin/README.md`(.ko). Bucket 4's condition — phrased as a reference to another project, never
as a description of this repo's current state — is met by those documents rather than by a
sentence's wording, because the import is **code, not prose**. If either document ever stops
saying that `admin/` targets the Chat Project's API, this reclassifies as a remnant.

**Two things this audit's Method could not have caught, now on the record:**

1. **The grep sets are documentation-only.** Both cover `--include="*.md" *.md ADR/
   .env.example`. The `admin/` import puts chat-project terms — `apollo`,
   `graphql-operations`, `errorLink`, `zustand`, `session-guard`, `protected-route`, plus room,
   presence, and nickname identifiers — into **tracked source code**, entirely outside that
   scope. Set A and Set B would report clean while the terms sit in `admin/src/`. Any future
   audit must state whether it covered code or only docs.
2. **`admin/` carries live remnants by design, quarantined rather than fixed.**
   `admin/vercel.json` pins a CSP `connect-src` to the Chat Project's Railway production host;
   `rooms-page.tsx`, `logs-page.tsx`, and `graphql-operations.ts` describe the chat domain and a
   `/graphql` endpoint this API does not have. They are committed **unmodified on purpose** so
   the adaptation task diffs against the original. Every one is itemized in ADR 0022's
   modification backlog and in `admin/README.md`. These are **not** bucket-1 remnants to remove
   now — they are the input to a scheduled rewrite. They stop being acceptable the moment
   `admin/` is wired into anything or deployed.

Doc-side verification for this change: the terms added to `*.md` here (`admin/`, `apollo`,
`graphql`, `zustand`, `vercel`, `railway`, `session-guard`, `protected-route`) all sit inside
ADR 0022, `admin/README.md`(.ko), and this section, each phrased as a reference to the Chat
Project's code. No hit describes this repository's own stack. **Remnants found: 0.**

**Correction (2026-08-13) — items 1 and 2 above are now stale; left in place as the honest
record of what this audit could not see on 2026-07-30, corrected here rather than rewritten.**
Item 2's list describes a 2026-07-30 snapshot: the 2026-08-06 console adaptation
([ROADMAP.md](ROADMAP.md) > Stage 5, `admin/README.md` > "What was adapted") **deleted**
`rooms-page.tsx` and `graphql-operations.ts` outright — they are not "committed unmodified"
waiting on a rewrite, they no longer exist — and rewrote `logs-page.tsx` against this API's
real routes, so it no longer describes the chat domain either. Only `admin/vercel.json`'s CSP
`connect-src` survived that pass as a live remnant, and it was fixed separately on 2026-08-13
(commit `f306813`, `admin/README.md` > "Provenance cleanup") — replaced with a
`localhost:3000` placeholder, no Railway host. Item 1's gap (grep sets never covering
`admin/src/`) is closed by the re-verification below, run against code for the first time.

## Re-verification — Code Scope (2026-08-13)

Closes item 1 above. Set A and Set B, run **verbatim**, for the first time against
`admin/src/`, `admin/vercel.json`, `admin/index.html`, `admin/package.json`, and `admin/e2e/`
— not just `*.md`/`ADR/`/`.env.example`.

```bash
grep -rniE "chat|redis|graphql|socket|pubsub|monorepo|railway|vercel|zustand|apollo|gemini|moderation|sendMessage|receiveMessage|resolver|gateway|subscription|frontend/|backend/|admin/|graphql-ws|ioredis|sentry|bullmq|session-guard|forceLogout|RoomEntity|ChatEntity|superadmin" \
  admin/src admin/vercel.json admin/index.html admin/package.json admin/e2e

grep -rniE "RbacGuard|GqlTransaction|QueryRunnerDecorator|RateLimitGuard|kickPrevious|AiService|AuditLog|MODERATION_|user_cache|SessionCache|EntityBase|schema\.gql|pnpm --filter|graphql-operations|errorLink|wsLink|reconnectSocket|protected-route|chat-page|DOMpurify|winston" \
  admin/src admin/vercel.json admin/index.html admin/package.json admin/e2e
```

**Remnants found: 0.** Every hit classified:

| Hit | Location(s) | Bucket | Action |
|---|---|---|---|
| `superadmin`, `AuditLog`, `zustand` | `auth/role.ts`, `store/auth.store.ts`, `lib/audit.ts`, `pages/*.tsx`, `package.json` | Own feature | Keep — this repo's real RBAC/audit vocabulary and a real state-management dependency, not chat-project holdovers |
| "Chat Project" prose (e.g. "that was the Chat Project's domain", "Chat Project's numeric 0/1/2") | `pages/dashboard-page.tsx:11`, `pages/logs-page.tsx:4`, `pages/users-page.tsx:4`, `store/auth.store.ts:4`, `e2e/logs.spec.ts:5`, `e2e/users.spec.ts:5` | Design reference | Keep — each names the Chat Project only to say this repo does **not** have that behavior |
| "an axios 401 and an Apollo UNAUTHENTICATED error firing at the same time" | `auth/session-guard.ts:75` | False positive | Keep — a hypothetical analogy illustrating a race condition, not a reference to the (deleted) Apollo dependency |
| `session-guard.ts`, `protected-route.tsx` (filenames/imports) | throughout `admin/src` | Own feature | Keep — this repo's own files; Set A's `session-guard` term was written to catch a chat-project file of the same purpose, not this one |
| `admin/vercel.json` content | — | — | No `railway`/`vercel`/`chat` hit inside the file itself — the CSP fix above already removed the only remnant string it carried |
| `rooms-page.tsx`, `graphql-operations.ts` | — | — | Confirmed absent (file search and grep both return nothing) — deleted 2026-08-06, not quarantined |

No bucket-1 hit. `admin/` is clean at both doc scope and code scope as of this
re-verification.

## Re-verification — Full Scope, "About to Be Published" Trigger (2026-09-07)

The re-verification trigger's third condition — "the repo is about to be published/tagged"
— had already fired without anyone noticing: confirmed via `gh repo view` that this
repository's GitHub visibility is `PUBLIC`, and has been for some time. This pass closes
that gap and, in the same run, extends coverage to two scopes the Method table (above)
never listed because they didn't exist yet at the 2026-07-22 audit: `frontend/` (created
2026-07-24) and a full `backend/` sweep (previously assumed clean by inheritance from the
2026-07-22 `CLAUDE.md` rewrite, never explicitly re-run against Set A/B).

Set A and Set B, run verbatim against: root `*.md`, `docs/` (including `ADR/`),
`.env.example`, `frontend/src` + `frontend/index.html` + `frontend/package.json`, all of
`backend/`, and `admin/src` + `admin/vercel.json` + `admin/index.html` +
`admin/package.json` + `admin/e2e` re-run for freshness (unchanged since 2026-08-13: same
`session-guard.ts`/`protected-route.tsx` own-file hits, same "moderation" negation).

**Remnants found: 0.** Every hit classified:

| Hit | Location(s) | Bucket | Action |
|---|---|---|---|
| "Chat Project" prose in ADR bodies (0009, 0010, 0013, 0022) and their design-reference callouts elsewhere | `docs/ADR/*`, `CLAUDE.md`, `docs/CHANGELOG.md` | Negation / design reference | Keep — each either rejects the term ("Never suggest GraphQL/WebSocket/gRPC") or explicitly cites the Chat Project as the admin console's declared import source |
| `winston`/`Sentry` | `CLAUDE.md`, `docs/ADR/0017` | Negation | Keep — "no new dependency" / "not yet adopted" |
| `superadmin` | `backend/auth/role/role.ts` and every RBAC call site | Own feature | Keep — this repo's real third role tier (ADR 0013), not a chat-project holdover |
| `AuditLogService`/`AuditLogModule`/`AuditLogEntity` | `backend/audit-log/`, and every module that injects it | Own feature | Keep — this repo's real append-only audit log (ADR 0013), matched only because Set B's `AuditLog` term was written to catch a *different* chat-project concept of the same name |
| "ported from Chat-project's filter minus its GraphQL branch and logger" | `backend/common/filter/all-exceptions.filter.ts:3` (file header) | Design reference | Keep — the mandatory Purpose/Usage/Rationale header (File Creation Convention) explicitly attributing provenance, not a description of this repo's current behavior |
| "no WebSocket in this project" | `frontend/src/features/posts/PostDetailPage.tsx:4` | Negation | Keep — explains why the thread refetches on explicit action instead |
| `resolveRoute` | `backend/metrics/metrics.interceptor.ts` | False positive | Keep — substring match on "resolver," an HTTP-route resolver, unrelated to GraphQL |

`.env.example`: zero hits, either set.

No bucket-1 hit anywhere. The repository is clean at full doc, `.env.example`, `frontend/`,
and `backend/` scope as of this re-verification — the widest single pass this plan has run.

## Re-verification — Developer-Requested Full Scope (2026-09-09)

Triggered directly by the developer asking for a re-check ("현 앱 트리 구성 요소 중 잔재
요소 조사 후 보고, 재진행") — not one of the three conditions Remaining Work item 2 lists
(new doc file / pasted-in content / about-to-publish). Recorded as a fourth, ad-hoc firing
rather than folded into item 2's list silently, since "developer asks directly" is a real
trigger this plan hadn't named yet.

Method: a blind full re-grep of Set A/B was skipped in favor of diffing against the last
full-scope pass (`63ce1a9`, 2026-09-07) and running both sets against every file touched
since — a blind re-grep is dominated by noise from `CLAUDE.md`'s own Concern-to-entrypoint
map, which legitimately contains `backend/`/`admin/`/`frontend/` path terms in bucket-3
context on nearly every line. This re-verification also swept the out-of-repo memory files
(item 3), last checked 2026-07-22.

62 files changed since `63ce1a9` (`git diff --name-only`), 5 newly added:
`admin/src/components/theme-toggle.tsx`, `admin/src/store/theme.store.ts` (+`.spec.ts`),
`frontend/src/features/account/SettingsPage.tsx` (+`.module.css`). Both sets run against
the full changed-file list.

**Remnants found: 0.** Every hit fell into the same buckets the 2026-08-13/2026-09-07
tables above already established — no new pattern:

| Hit | Location(s) | Bucket | Action |
|---|---|---|---|
| `superadmin`, `AuditLog`, `zustand` (code) | `CLAUDE.md`(.ko) entrypoint map/RBAC sections, `admin/src/store/theme.store.ts` import path only | Own feature | Keep |
| "Chat Project" prose narrating the 2026-07-30 import and 2026-08-06 adaptation (`rooms-page`, Apollo/`/graphql`, ban/force-logout as *removed* items) | `admin/README.md`(.ko), `docs/CHANGELOG.md`(.ko), `docs/ROADMAP.md`(.ko) | Design reference | Keep — all past-tense, all describing what was deleted, none describing this repo's current stack |
| `winston`/`Sentry` | `CLAUDE.md`(.ko) | Negation | Keep |
| "chat-project git-history remnant handling", "chat response" | memory (`session-prompts.md`, `ask-with-comparison-tables.md`) | False positive / self-reference | Keep — the first *is* this plan's own item 1, already resolved; the second is unrelated prose |

The 5 newly added files (theme toggle, theme store, Settings page) produced zero hits in
either set — no remnant terms entered with them. `.env.example` was not in the changed-file
list, so it carries forward the 2026-09-07 result (0 hits, both sets) unverified-but-
unchanged. Memory files: clean, same as 2026-07-22.

No bucket-1 hit. The repository stays clean at HEAD as of this pass — the fourth
consecutive clean full-scope re-verification.

## Remaining Work (Pending)

1. ~~**Git history decision**~~ — **decided 2026-09-07: leave as-is.** Commits up to
   `4d00bc2` still contain the chat-app `CLAUDE.md` (readable via
   `git show c8eb19f:CLAUDE.md`). The recommended option was chosen: it is an honest
   historical record; a history rewrite (`filter-repo`) is destructive, breaks all
   existing commit hashes cited in `CHANGELOG.md`/`ROADMAP.md`, and the content misleads
   no one reading HEAD. The only case that would have justified rewriting — content that
   must not be publishable — never applied here (design docs and code, not secrets or
   PII), and the 2026-09-07 full-scope re-verification above reconfirmed the repo is
   clean at HEAD regardless of what old commits carry. Framed as implement-only-if-needed:
   revisit only if a future, currently unforeseen reason to scrub history actually
   surfaces — not proactively.
2. **Re-verification trigger** — re-run the Method grep sets whenever:
   - a new documentation file is added, or
   - content is pasted in from another project or an older branch, or
   - the repo is about to be published/tagged, or
   - the developer directly asks for a re-check (added 2026-09-09 — the fourth firing
     didn't fit any of the first three).

   Fired four times so far — the `admin/` import (2026-07-30, doc scope), the code-scope
   re-verification (2026-08-13, closing the doc-only gap the first pass left open), the
   "about to be published" condition (2026-09-07, discovered already-fired rather than
   anticipated — the repo had been public for a while before anyone re-ran this Method
   against it), and a direct developer request (2026-09-09, diffed against the prior pass
   rather than blind-re-running both sets — see that section above for why). Any future
   pass should keep widening scope rather than narrowing back to docs-only or to a single
   subfolder.
3. **Memory hygiene** — out-of-repo memory files were clean on 2026-07-22; re-check
   whenever a memory entry is added that references project architecture.

## Completion Criteria

This plan closes when (1) the git-history decision is made and recorded here, and
(2) the re-verification trigger is either adopted as a habit or automated (as a job
in the now-landed Stage 1 CI pipeline, [ADR 0016](ADR/0016-github-actions-ci.md)).

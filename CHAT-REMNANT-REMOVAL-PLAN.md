# Chat-Project Remnant Removal Plan

> 한국어 버전: [CHAT-REMNANT-REMOVAL-PLAN.ko.md](CHAT-REMNANT-REMOVAL-PLAN.ko.md)

**Status: Pending (recorded for future processing)** — audit executed 2026-07-22;
remaining actions are listed under [Remaining Work](#remaining-work-pending).

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

Every hit is classified into one of three buckets:

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

## Remaining Work (Pending)

1. **Git history decision** — commits up to `4d00bc2` still contain the chat-app
   `CLAUDE.md` (readable via `git show c8eb19f:CLAUDE.md`). Options:
   - **Leave as-is (recommended)** — it is an honest historical record; a history
     rewrite (`filter-repo`) is destructive, breaks all existing commit hashes cited
     in `CHANGELOG.md`/`ROADMAP.md`, and the content misleads no one reading HEAD.
   - Rewrite history — only justifiable if the old content must not be publishable.
   Decision deferred to the developer; no action until explicitly chosen.
2. **Re-verification trigger** — re-run the Method grep sets whenever:
   - a new documentation file is added, or
   - content is pasted in from another project or an older branch, or
   - the repo is about to be published/tagged.
3. **Memory hygiene** — out-of-repo memory files were clean on 2026-07-22; re-check
   whenever a memory entry is added that references project architecture.

## Completion Criteria

This plan closes when (1) the git-history decision is made and recorded here, and
(2) the re-verification trigger is either adopted as a habit or automated (a CI job
would land under ROADMAP's "CI" candidate — not before).

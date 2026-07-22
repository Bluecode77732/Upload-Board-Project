# Roadmap

> 한국어 버전: [ROADMAP.ko.md](ROADMAP.ko.md)

Decided next steps and known gaps for the Upload Board Project. Priorities follow
security → decided architecture work → hygiene → docs/tests. Each roadmap item lands
as its own dedicated, designed change (see [CLAUDE.md](CLAUDE.md) — Scope Discipline).

## Decided roadmap items

### 1. TypeORM migration adoption
- **What**: `migration:generate` / `migration:run` scripts, `src/data-source.ts`,
  `src/migrations/` — replacing the manual "flip `synchronize` locally" workflow.
- **Why now**: it is the prerequisite for any schema change, including RBAC's `role`
  column below.
- **Notes**: the existing dev DB was created manually, so adoption needs a baseline
  strategy (initial migration marked as applied) — decide it before the first
  `migration:run`.

### 2. RBAC
- **What**: `UserEntity.role` column + role-aware guard/decorator.
- **Decided design (2026-07-22)**: Chat-project style — three tiers
  (`user` / `admin` / `superadmin`) plus a `PATCH /user/:id/role` endpoint restricted
  to superadmin. Ownership checks (landed 2026-07-22) extend to
  "self **or** admin".
- **Depends on**: migration adoption (needs the `role` column).

## Quick fixes (small, unscheduled)

- Decide the cascade/ownership-transfer policy for `DELETE /user/:id` when the user
  owns files — `FileEntity.creator` is `nullable: false`, so today it surfaces as a
  confusing FK-constraint 500.
- Decide the license: `package.json` says `UNLICENSED`; the pre-rewrite README
  claimed MIT. Needed before the repo is published.

## Larger unscheduled work

- **E2E test rewrite** — `test/app.e2e-spec.ts` is the untouched Nest template
  (targets `GET /`, which does not exist) and requires a live DB to boot AppModule.
  A meaningful suite would cover: auth flow, ownership 403s, pagination, and the
  `temp_` → `granted_` upload promotion.
- **Dev-transitive audit findings** — `pnpm audit` still flags handlebars (via
  ts-jest) and glob/minimatch (via jest, @nestjs/cli). Build/test-time only; waiting
  on upstream releases. Runtime findings (jws, validator) were pinned via
  `pnpm.overrides` on 2026-07-22.
- **Chat-project remnant handling** ([plan](CHAT-REMNANT-REMOVAL-PLAN.md)) — all
  tracked docs audited 2026-07-22: 0 remnants (hits were deliberate negations, own
  features, or explicit design references). Pending: git-history decision (old
  commits still carry the chat-app CLAUDE.md) and the re-verification trigger for
  new or pasted-in docs.

## Completed (2026-07-22)

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

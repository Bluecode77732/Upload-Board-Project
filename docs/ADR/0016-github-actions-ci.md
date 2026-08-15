# ADR 0016: Continuous Integration with GitHub Actions

- Status: Accepted
- Date: 2026-07-25
- 한국어: [0016-github-actions-ci.ko.md](0016-github-actions-ci.ko.md)

## Context

The 0-error lint baseline and the passing unit/e2e suites were enforced only by
human memory — nothing stopped a lint error or a failing test from being merged.
CI was a decided Stage 1 item, unblocked once the toolchain was pinned
([ADR 0014](0014-node-pnpm-version-pinning.md), so an install is reproducible) and
a container Postgres image was in use ([ADR 0015](0015-docker-and-compose.md), so
the e2e suite has a DB to run against). The brief is explicit: a minimal pipeline,
nothing more.

## Decision

- **One GitHub Actions workflow** — `.github/workflows/ci.yml`, on `push` and
  `pull_request` to `main`/`dev`, with `permissions: contents: read`.
- **Two jobs.** `lint-and-unit` runs `lint:ci` + `pnpm test` (no DB). `e2e` runs
  the suite against a `postgres:16` service container. Split because the unit path
  is fast and DB-free while the e2e path needs a service — keeping the common
  signal fast and the failure precise.
- **Toolchain from the pin.** `actions/setup-node` with
  `node-version-file: .nvmrc`, then `corepack enable` activates the
  `packageManager` pnpm (ADR 0014). The workflow reads the same version source the
  Dockerfile does — no version duplicated in YAML.
- **New `lint:ci` script** — `eslint` **without** `--fix`. CI must fail on a
  violation, not silently auto-fix and pass. `pnpm lint` (with `--fix`) stays the
  local convenience.
- **e2e env in the workflow.** There is no `.env` in CI, so the required Joi vars
  are provided via job `env:` (throwaway secrets). The `postgres:16` service
  (matching ADR 0015) has a `pg_isready` healthcheck so steps wait for it, and
  `mkdir -p file/temp file/upload` recreates the untracked upload dirs the
  promotion test writes to.

## Alternatives rejected

- **Run `pnpm lint` (with `--fix`) in CI** — it auto-fixes then exits 0, hiding
  violations that should fail the build. `lint:ci` gates honestly.
- **A single job for everything** — forces every unit run to spin up Postgres.
  Splitting keeps the DB-free path fast and the failure signal precise.
- **`pnpm/action-setup`** — works, but Corepack + `.nvmrc` reuses ADR 0014's single
  source with no extra action and stays consistent with the Dockerfile.
- **Skip e2e in CI** — the e2e suite is the main regression net for the
  request→response paths; running it (now that a container DB is one line) is the
  whole point of Stage 1 test reliability.

## Consequences

- Verified green 2026-07-26: both jobs (`lint-and-unit`, `e2e`) pass in CI on `dev`.
  (The first run also proved its worth — it caught a real e2e defect masked locally by
  the dev DB already having the schema; fixed in `test/e2e-env.ts`.)
- lint (0-error) and the unit + e2e suites are enforced on every push/PR, not by
  memory. The baseline CLAUDE.md documents is now machine-checked.
- No dependency caching yet — each run reinstalls (acceptable for a minimal
  pipeline; a pnpm-store cache is a later tightening).
- Not a deploy pipeline: no image build/push, no environment gates. Those arrive
  with Stage 4 (see the container/deploy hardening row in ROADMAP).
- CLAUDE.md's "no CI workflow" / CI/CD "None" statements are updated to reflect the
  workflow (and the ADR 0015 Dockerfile) now existing; git hooks still do not.

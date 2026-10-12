# ADR 0015: Docker and docker-compose for Local Development

- Status: Accepted
- Date: 2026-07-25
- 한국어: [0015-docker-and-compose.ko.md](0015-docker-and-compose.ko.md)

## Context

The database was provisioned by hand — a manually-created `upload-board-pg`
container that each contributor had to remember to start. That is the biggest
onboarding friction and, since the e2e suite ([ADR-less Stage 1 task](../ROADMAP.md))
now needs a live Postgres, its only remaining external dependency. Reproducible
builds and the eventual AWS deployment (Stage 4) both need the app itself
containerized. Toolchain pinning ([ADR 0014](0014-node-pnpm-version-pinning.md))
was done first precisely so the image base tag has a single source.

## Decision

- **Multi-stage `Dockerfile`.** Build stage on `node:24.8.0` (the full image has
  the compilers a native build could need); runtime on `node:24.8.0-slim`. Dev
  deps are installed for `nest build`, then `pnpm prune --prod` strips them and the
  prod `node_modules` are copied to the slim stage — `bcrypt` ships glibc prebuilds,
  so nothing recompiles on slim. Base tags come from ADR 0014's pin.
- **Migrations on boot.** The runtime `CMD` runs the committed migrations
  (`typeorm migration:run -d dist/data-source.js` — idempotent, uses only the
  compiled data source + the typeorm CLI, no nest/pnpm at runtime) and then
  `node dist/main`, so `docker compose up` is a single command against a fresh
  volume.
- **`docker-compose.yml` = `db` + `api`.** `db` is `postgres:16`, publishes
  `${DB_PORT}:5432`, has a named volume and a `pg_isready` healthcheck; `api`
  builds the Dockerfile, waits on `db` health, reads `.env` via `env_file`, and
  overrides `DB_HOST=db`/`DB_PORT=5432` for the compose network. It supersedes the
  manual `upload-board-pg`.
- **Secrets never baked.** `.dockerignore` excludes `.env*`; env is injected at
  runtime. Compose reads DB creds/port from the same `.env` the app uses, so the
  published port matches and host-run e2e/migrations hit the same database.
- **Scope: local dev + a build image.** Production hardening (non-root user,
  distroless, a health endpoint, an image registry, a CI build) is deferred to the
  CI task (next) and Stage 4.

## Alternatives rejected

- **Single-stage image** — ships dev deps and compilers into the runtime; larger
  attack surface and size. Multi-stage is the standard split.
- **Alpine base** — musl libc breaks `bcrypt`'s glibc prebuilds, forcing a source
  recompile (and the build tools that go with it). Debian `slim` matches the build
  stage's glibc, so the prebuilt binary just works.
- **Bake `.env` into the image** — leaks secrets into image layers. Runtime
  injection via `env_file` is the norm.
- **Migrations as a separate compose one-shot service** — chosen against in favor
  of the `api` `CMD` running them: committed migrations are already reviewed,
  `migration:run` is idempotent, and folding it into boot keeps `up` a single
  command. Auto-*generate* is never run here — only *run*.

## Consequences

- Runtime-verified 2026-07-26: `docker compose up` boots the API, applies the three
  migrations on start, and serves (`GET /doc` → 200, `POST /auth/register` → 201).
- `docker compose up` brings up Postgres + the API locally; the e2e's
  "needs a manually-started Postgres" dependency is removed for anyone on compose.
- A fresh compose volume is schema-ready without a manual migration step (boot
  applies them); an existing volume is unaffected (idempotent).
- Host port 5435 is shared with the legacy `upload-board-pg` — that container must
  be stopped before `docker compose up`. Retiring it is a manual, non-destructive
  follow-up (its data is dev-only), left to the contributor.
- Not yet production-grade: the container runs as root with no distroless base,
  health endpoint, or registry push. Those land with CI (Stage 1) and Stage 4,
  each with its own record.

### Addendum (2026-10-03) — optional `.env.local` for per-machine overrides

`api` and `migrate` now read `.env` and then an optional `.env.local` (`x-env-files` in
`docker-compose.yml`, `required: false`, which needs Compose 2.24 or newer). Context: a
developer's `.env` can point at S3 (`STORAGE_DRIVER=s3`); once the AWS stack is down the
bucket is gone and every upload returns 500 (`NoSuchBucket`), and `.env` is the file that
holds the real settings. The host-run backend already had a per-machine override —
`backend/app.module.ts` reads `['.env.local', '.env']` and `.env.local` is gitignored — but
compose did not, and `.dockerignore` keeps `.env.*` out of the image, so a `.env.local` never
reached the container. Now one gitignored file changes local values for both ways of running.
The commit that added the host-side override (`3bd5dfd`, 2026-09-09) recorded, as something it
had checked live, that `.env.local` flows into neither the image nor the compose containers.
This change reverses only the second half: the image still never contains it (`.dockerignore`),
while the compose containers now receive it at run time, on the machine that has the file.

Precedence runs opposite in the two tools (Nest: the first file wins; Compose: the later file
wins), so the list order is `.env`, then `.env.local`. A throwaway test with dummy files
confirmed that the later file overrides and that an absent `.env.local` is not an error;
after the change, removing the temporary override file left the `api` container on
`STORAGE_DRIVER=local`, and a real upload (ClamAV scan, stored file, authenticated playback)
worked against it. `environment:` entries in the compose file (`DB_HOST`, `CLAMD_HOST`, ...)
still win over both files.

Rejected: a `docker-compose.override.yml` (compose loads it by name automatically and nothing
in `.gitignore` covered it, so it could be committed by accident and then change everyone's
defaults), and editing `.env` (it holds the real settings and is not read or written by the AI
tooling here). Not changed: the Joi schema and the `STORAGE_DRIVER` default (`local`) —
[ADR 0029](0029-storage-port-adapter.md) D3.

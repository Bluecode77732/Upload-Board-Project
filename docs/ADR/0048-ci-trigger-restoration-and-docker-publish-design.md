# ADR 0048: CI Trigger Restoration and `docker-publish` Branch-Aware Design

- Status: Accepted — implemented (see Addendum)
- Date: 2026-08-30
- Amends: [ADR 0016](0016-github-actions-ci.md) (Continuous Integration with GitHub Actions)
- 한국어: [0048-ci-trigger-restoration-and-docker-publish-design.ko.md](0048-ci-trigger-restoration-and-docker-publish-design.ko.md)

## Context

ADR 0016's Decision text is explicit: the workflow runs "on `push` and
`pull_request` to `main`/`dev`." At the start of this session (2026-08-30), the
actual `.github/workflows/ci.yml` had both triggers narrowed to `main`-only — a
drift from the ADR 0016 decision that no ADR ever recorded. ADR 0016 also
explicitly scoped image build/push out of its decision ("Not a deploy pipeline:
no image build/push... those arrive with Stage 4"). Stage 4 later added a
`docker-publish` job, but no ADR ever documented its design either — this ADR is
its first record.

The undocumented `main`-only trigger on `docker-publish` was the direct cause of
the recurring stale-image incidents recorded in [ROADMAP.md
§7](../ROADMAP.md#7-unscheduled--open-decisions) (found 2026-08-28, recurred
2026-08-29/30): this project's actual development happens on `dev`, which had
never triggered an image build, so `k8s/helm/values.yaml`'s `image.tag: latest`
default (and even `values-prod.yaml`'s pinned tag) silently pointed at code that
predated whatever had just landed on `dev`. That ROADMAP entry recorded three
candidate fixes (a/b/c) without picking one, pending developer input. This ADR
records option (b) — change `docker-publish`'s trigger to also build on `dev`
push — being implemented and live-verified.

## Decision

### D1 — Trigger restoration is partial, not a full revert to ADR 0016's text

`push` is restored to `[main, dev]`, matching ADR 0016's original decision.
`pull_request` is deliberately kept at `[main]`-only — this is a considered
choice, not the same kind of undocumented drift that produced the gap this ADR
closes: in this project's actual workflow, `dev` normally receives direct
pushes rather than pull requests, so PR-triggered CI on `dev` has low practical
value, and restoring it wasn't requested. If `dev` starts receiving PRs as a
matter of course, this row should be revisited.

### D2 — `docker-publish`'s branch-aware tag/platform design (first documented here)

- `main` keeps `:latest` + `:<sha>` on the existing `linux/amd64,linux/arm64`
  multi-arch build — unchanged.
- `dev` gets `:<sha>` only (never `:latest`) on a `linux/amd64`-only build.

Rationale: `dev` now publishes far more often than `main` and has no `:latest`
consumer depending on it. Neither branch has ever had *runtime* arm64
verification — QEMU-emulated container execution is impractical, so only "the
build completed" was ever checked for arm64 either way. Dropping `dev`'s arm64
build therefore costs only an early *build*-failure signal (which still
surfaces at the next `main` merge, before deployment), not any runtime signal,
since none existed for arm64 on either branch. Halving `dev`'s QEMU cost was
judged worth that trade-off given how much more often `dev` now publishes.

### D3 — Workflow-wide `concurrency`

A `concurrency: { group: ${{ github.workflow }}-${{ github.ref }},
cancel-in-progress: true }` block was added so a rapid string of pushes to the
same branch (`dev` especially, now that it triggers the full pipeline) cancels
a superseded run instead of letting every one of them finish.

### D4 — Pre-push smoke test (new coverage)

Before the real multi-platform `--push` build, a new step builds the amd64
image locally (`--load`, GHA-cached via `type=gha` so the later push build
doesn't repay the full compile cost), runs it against a throwaway `postgres:16`
service over `--network host`, and polls the Dockerfile's own `HEALTHCHECK`
(`GET /health/live`) until it reports `healthy` before anything is pushed. This
is genuinely new coverage: no prior `docker-publish` run, on either branch, ever
verified that the built image actually boots — only that the build itself
completed.

### D5 — `docker/login-action` bumped `v3` → `v4`

Discovered live-verifying D1–D4 on a real `dev` push: `docker/login-action@v3`
(a `node20`-runtime action) began failing immediately with "malformed HTTP
Authorization header" once GitHub Actions started forcing `node20`-targeted
actions onto a `node24` runtime by default. This was ruled out as a Docker Hub
credential problem before being diagnosed as a runtime issue — the identical
failure persisted across two independent credential rotations. `v4` ships a
native `node24` build with byte-identical inputs to `v3` (verified by diffing
`action.yml` between the two), so the bump is a drop-in fix for the
Node-runtime mismatch, not a behavior change. (The actual root cause turned out
to be a stray character in the `DOCKER_USERNAME`/`DOCKER_PASSWORD` secret
values from a web-UI paste — but the `v3`→`v4` bump was kept regardless, since
it is the correct underlying fix for the Node-runtime incompatibility it was
diagnosing, independent of that separate credential-formatting issue.)

## Consequences

- **Live-verified end-to-end 2026-08-30** on a real `dev` push: all 6
  verification jobs passed, `docker-publish` logged in (`v4`), ran the smoke
  test to a `healthy` container, and pushed —
  `bluecode1775/sharenpo:<sha>` appeared on Docker Hub as a
  **single-architecture (`amd64`) image**, and no `:latest` tag was touched (it
  does not currently exist on Docker Hub at all — every image on Docker Hub
  before this had been pushed manually, consistent with `docker-publish` never
  having reached a successful push prior to this ADR).
- Closes [ROADMAP.md §7](../ROADMAP.md#7-unscheduled--open-decisions)'s
  `image.tag: "latest"` stale-deploy item via option (b). Options (a) (drop
  `values.yaml`'s `image.tag` default) and (c) (merge `dev` into `main` on a
  cadence) were not pursued — (b) alone closes the "an image never gets built
  from `dev`" gap the row existed for.
- Two pre-existing, unrelated defects surfaced and were fixed while
  live-verifying this ADR, since `dev` had genuinely never exercised these
  paths before: `test/app.e2e-spec.ts`'s `seedFile` helper predated [ADR
  0040](0040-persisted-media-type-for-playback.md)'s `NOT NULL mediaType`
  column; and the `docker/login-action` bump above. Both are recorded in
  `CHANGELOG.md`, not restated here — this ADR records the CI-design decisions,
  not every defect fixed while verifying them.
- `CLAUDE.md`'s CI/CD section is updated in the same change: it now mentions
  `docker-publish`'s existence, branch-aware tag/platform split, and the smoke
  test (citing this ADR rather than restating the detail), and its "push/PR to
  `main`/`dev`" phrasing is corrected — `push` covers `main`+`dev`,
  `pull_request` covers `main` only (D1).
- No dependency caching existed for `docker-publish` before this ADR; D4's
  smoke-test build now uses GitHub Actions cache (`type=gha`) so the later push
  build reuses its layers — the first caching this job has had.

### Addendum (2026-08-31) — four design gaps found and closed the next day

A review the following day surfaced four gaps in this ADR's own design, all
introduced by this ADR itself (not pre-existing beyond what's noted) and all
closed in the same pass:

- **Unbounded Docker Hub tag growth.** `dev` now publishes a `:<sha>` tag on
  every push (D2), with nothing ever deleting old ones — Docker Hub's free
  tier has no built-in retention policy. Closed with a new scheduled workflow,
  `.github/workflows/docker-tag-cleanup.yml`: weekly (and `workflow_dispatch`-
  triggerable), it keeps the newest `KEEP=30` tags and deletes the rest — but
  **only** among tags matching a 40-hex-char git-SHA shape (`^[0-9a-f]{40}$`,
  exactly what `${{ github.sha }}` produces). This is safety by construction,
  not by an exclusion list: `:latest` and any manually-created tag (e.g.
  `values-prod.yaml`'s pinned `image.tag`, or the `db-ssl-ca`/`2cd73b9`-style
  tags already on Docker Hub from pre-ADR-0048 manual pushes) can never match
  that pattern, so they can never be selected for deletion regardless of how
  `KEEP` is tuned. A `workflow_dispatch` run defaults to a dry run (lists what
  would be deleted, deletes nothing) unless the trigger explicitly opts out;
  the scheduled cron run always deletes for real. **Not yet live-run** — the
  next scheduled run, or a manual `workflow_dispatch` dry run, is the first
  real exercise of this script; nothing about it could be safely verified
  without actually calling Docker Hub's delete API.
- **`docker-publish`'s `needs` gated on unrelated deployables.** It listed all
  six jobs including `frontend-lint`/`frontend-e2e`/`admin-lint-and-unit`/
  `admin-e2e` — pre-existing before this ADR, but harmless while the job was
  `main`-only. Now that `dev` triggers it on every push, an unrelated frontend
  or admin test flake would block a correct backend image from publishing far
  more often. The root Dockerfile builds `backend/` only (`frontend/` and
  `admin/` are independent projects with their own tooling, not part of this
  build — CLAUDE.md's Project Overview), so those four jobs say nothing about
  whether the backend image is safe to publish. Narrowed `needs` to
  `[lint-and-unit, e2e]` — the two jobs that actually exercise what gets
  packaged.
- **The smoke test (D4) never explicitly verified database connectivity.**
  `GET /health/live` is deliberately DB-independent by design (ADR 0031) — the
  original smoke test only polled that endpoint. It's not that nothing was
  verified: NestJS's bootstrap won't reach a listening HTTP server (and so the
  `HEALTHCHECK` could never succeed) unless the initial `TypeOrmModule`
  connection to Postgres succeeded, so a connection-level failure (the class of
  bug behind the ROADMAP-recorded `DB_SSL` incident) was always going to be
  caught — but only as a side effect of Nest's initialization order, not as an
  intentional check. `GET /health/ready` exists specifically to ping the
  database (`HealthService.checkDatabase`, ADR 0031) and was never called by
  this smoke test. Added a step that curls it directly (the smoke-test
  container runs with `--network host`, so its port 3000 is the runner's own)
  after the liveness check passes.
- **The health-check polling window wasn't derived from the Dockerfile.** The
  original loop (30 iterations, `sleep 2`) was copied from an unrelated
  pattern elsewhere in `ci.yml` — the "wait for backend" loops in
  `frontend-e2e`/`admin-e2e`, which curl a bare `node dist/main` process
  directly with no interval-gating. The Dockerfile's `HEALTHCHECK` only
  re-evaluates every `interval=30s` (after `start-period=10s`), so a container
  needing two check cycles to go healthy has no principled guarantee of
  finishing inside a 60-second window. Re-derived from the Dockerfile's own
  constants: 18 iterations at `sleep 5` = 90s, comfortably covering two full
  check cycles (~t=0s, ~t=30s) plus margin.

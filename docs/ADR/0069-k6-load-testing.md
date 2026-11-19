# ADR 0069: k6 load testing across user and admin flows, up to 500+ VUs

- Status: Proposed — Phase 1 implemented (tooling, seed, 10-VU smoke); the load levels have not been run
- Date: 2026-11-19
- Amends: [ADR 0049](0049-performance-capacity-criteria.md) D2 (which considered and rejected k6)
- 한국어: [0069-k6-load-testing.ko.md](0069-k6-load-testing.ko.md)

## Context

ADR 0049 measured eight fixed requests with autocannon at 20 connections for 10 seconds, one
logged-in user, one endpoint at a time. That answers "is this query fast at 10^4 rows". It
cannot answer how the app behaves when several hundred people use it at once: each person holds
a session that expires every 180 seconds and refreshes through an httpOnly cookie, mixes reads
with writes, uploads through the ClamAV gate, and some flows need two accounts in turn (a file
transfer is proposed by the owner and accepted or rejected only by the target, ADR 0050 D4).

ADR 0049 D2 rejected k6 because it is a standalone binary outside the pnpm toolchain and the
endpoint shapes then under test did not need it. The second half no longer holds for this
question. autocannon replays one prepared request per run; it has no per-user state, cookie
jar, or multi-step flow.

The existing `perf/load-test.js` also had two defects found while preparing this work: it judged
PASS/FAIL on latency alone, so a fast 403 counted as a pass, and its write target
(`perf-file-000001-trip`) belongs to a different seed user than the one it logs in as, so every
`PATCH` in that benchmark was a 403 `FORBIDDEN_NOT_OWNER` (checked against a fresh seed on
2026-11-19). Its header pointed at a `perf/README` that did not exist.

## Decision

### D1 — k6 for multi-step load; autocannon stays for ADR 0049's fixed baseline

k6 runs as the `grafana/k6:2.3.0` Docker image (released 2026-09-21; 2.4.0 came out on
2026-11-12, under two weeks before this decision, so it was not used). k6 is AGPL-3.0. It runs as
a separate process against the app over HTTP and is never added to `package.json`, bundled, or
shipped, so its licence does not reach the app. Scripts live in `perf/k6/`.

### D2 — Workload: one account per VU, a fixed mix, human think time

- Accounts: `perf-vu-n` for VU `n` (n = 1..2000) and a partner `perf-partner-n` per VU for the
  accept/reject side of a transfer. One account holds one session (ADR 0012); two VUs sharing an
  account would keep invalidating each other's refresh token. `perf-vu-0` is used by `setup()`
  only and stays a plain user so it sees what any user sees. Roles: VU 1 is superadmin, every
  50th VU is admin, so admin traffic is present at every level from 50 VUs up.
- Each VU owns one seeded private file (1KB on disk) for visibility changes, unlisted share-token
  reads, and transfer round trips. An interrupted transfer is repaired at the start of the next
  file action (cancel a pending transfer, or have the partner hand the file back).
- Mix per iteration: browse 70 (lists, search, sort, `creatorId`, details, comment threads,
  anonymous public content, own profile), write 20 (post and comment CRUD keeping at most five of
  each, visibility and share tokens), upload 5 (attach → `POST /file`, sometimes the same filename
  again for the 200 replay, half deleted), account/transfer/admin 5 (refresh, signout → signin,
  `PATCH` self, lookup, transfer accept/reject/cancel, register → self-delete; admins list users
  and the audit log, the superadmin toggles its partner's role).
- 0.5–1.5 s of random think time between iterations, so the VU count reads as concurrent users.
  Without it, 500 VUs would mean whatever request rate the app could sustain, not 500 people.
- Request timeout 30 s, set explicitly (k6's default is 60 s). Upload payloads are a 1x1 JPEG,
  so 30 s is never a legitimate duration.

### D3 — Every response is classified against a plan

Each request names a plan: the statuses it may succeed with and the `ErrorCode`s it may be
refused with by design. Three counters come out of that:

- `designed_rejection{code}` — the API refused as specified (for example `AUTH_EMAIL_TAKEN`,
  `FILE_SHARE_INVALID` for a rotated share token, `FILE_TRANSFER_INVALID_TARGET`). Some of these
  are sent on purpose so the count proves the path works.
- `unexpected_failure{type}` — `timeout`, `connection` (status 0), `internal_error`,
  `no_code_5xx`, `server_error`.
- `unplanned_response{endpoint}` — any other status, including a 4xx with a code the plan does
  not list.

The `ErrorCode` list is read from `backend/common/error-code.ts` when the script starts, so it
cannot drift from the code. A run passes when `unexpected_failure` and `unplanned_response` are
both 0. URLs with ids are grouped under a fixed `tags.name` to keep the metric count bounded.

### D4 — How it runs

- One VU level per run (`TARGET_VUS`, `RAMP`, `HOLD`; 3 minutes held per level, longer than the
  180 s access-token lifetime so the refresh path is under load). A single ramping run was
  rejected because it cannot stop between levels.
- Recovery: right after a load run, 10 VUs for 60 s. It passes when that p95 is at most twice
  the smoke p95.
- Throttling is off during load runs (`THROTTLE_ENABLED=false`): every VU leaves from the same
  host, so the per-IP limits (ADR 0053/0054) would turn the test into a test of the throttle.
  `perf/k6/throttle.js` checks the limits separately: the 6th signin and the 101st `GET /file`
  in a minute must be 429 `RATE_LIMITED`.
- Isolation: dedicated throwaway containers (`postgres:16` on 5436, `clamav/clamav:stable` on
  3311), not the compose `db`/`clamav` services, because compose reads `.env` and would create the
  dev database volume. The app, migrations and seed run from a sandbox directory outside the repo
  with freshly generated secrets, so neither the repo's `.env` nor its `file/` directory is read
  or written. `perf/README.md` has the commands.

### Alternatives rejected

- **Extending autocannon**: no per-user state, cookies, or multi-step flows; every one of those
  would have to be written by hand around it.
- **A shared partner pool instead of one partner per VU**: the shared accounts' sessions would
  collide (one session per account). Dropping accept/reject from the mix would halve the accounts
  but leave the consent side of ADR 0050 unloaded.
- **Running k6 from the host binary**: not installed here, and the pinned image keeps the version
  reproducible.

Artillery, the other tool ADR 0049 rejected, was not re-evaluated.

## Consequences

- No new pnpm dependency. New files `perf/k6/load.js`, `perf/k6/throttle.js`, `perf/README.md`
  (+ `.ko.md`). `perf/seed.js` now also inserts 4,001 accounts and 2,000 files; it still only
  writes inside the current directory.
- `perf/load-test.js` reports `FAIL` when `non2xx`, `errors` or `timeouts` is non-zero, and
  measures `perf-file-000000-holiday`, a public file owned by the measure user, with a
  `{ visibility: 'public' }` PATCH (an idempotent write on a public file; same-title PATCHes are
  refused, see below). All eight benchmarks pass after the fix; the write now measures p50 28 ms,
  p97.5 60 ms on the success path. ADR 0049 D3's
  `PATCH /file/:id` row (16/19 ms) was therefore measured on the 403 path, not on a write: both
  scripts are unchanged since that ADR's commit (`a4c1261`), and the file ownership check predates
  it (2026-07-24). Its table is left as written.
- Smoke result (10 VUs, 10 s ramp + 2 min, 2026-11-19): 1,568 requests at 11.9/s, 0 unexpected
  failures, 0 unplanned responses. Designed rejections: `FILE_SHARE_INVALID` 15,
  `FILE_TRANSFER_INVALID_TARGET` 2, `FILE_NO_PENDING_TRANSFER` 2, `AUTH_EMAIL_TAKEN` 1. Every
  ADR 0049 tier was within target (p95: list 11.9, detail 4.9, content 16.4, write 12.0 ms). 31 of
  the 32 planned endpoints were hit; `GET /audit-log` needs an admin VU, and the first one is VU 50.
  All 11 refreshes succeeded. A 60 s recovery-mode run right after it gave p95 13.6 ms against the
  31.0 ms bound (PASS). A 3-VU, 190 s run showed the token-age refresh working (3 refreshes, 0
  failures), and `throttle.js` found the 6th signin and the 101st `GET /file` refused with 429
  `RATE_LIMITED`, as designed.
- Found while verifying:
  - **Connection-pool deadlock — fixed the same day.** `FileService.uploadFile` and `updateFile` hold a QueryRunner
    connection for the whole transaction, and inside it run the duplicate-title check on
    `this.fileRepository`, a second pool connection (`uploadFile` also calls `findClaim` after
    rollback but before `release()`). With the default pool of 10, ten concurrent requests on that
    path each hold one connection and wait for an eleventh, and nothing times out. Reproduced
    twice: 20 concurrent same-title PATCHes (autocannon) and 20 concurrent `POST /file` promotions.
    Every one hung, `GET /health/ready` stopped answering, `pg_stat_activity` showed 10 sessions
    `idle in transaction`, and only a restart recovered. `GET /health/live` does not touch the DB,
    so a liveness probe would keep the pod alive while it serves nothing. Twenty concurrent
    visibility PATCHes, which skip the title check, did not hang. The three reads now use
    `queryRunner.manager`, so each transaction holds one connection. Against the fixed build, the
    same 20-way runs returned 20 × 201 (`POST /file`), 20 × 200 (title PATCH) and 20 × 200 (replay),
    with `/health/ready` up and no session left `idle in transaction`; 20 concurrent submits of one
    filename gave 1 × 201 and 19 × 200, and of one title 1 × 201 and 19 × 400 `FILE_TITLE_TAKEN`.
    The pool still has no acquire timeout (CLAUDE.md > Known gaps, 2026-10-12 review), so a future
    read of the same shape would hang the same way.
  - **A same-title PATCH is refused — not fixed, undecided.** `updateFile`'s duplicate check does not exclude the row
    being updated, so `PATCH /file/:id { title: <its current title> }` answers 400
    `FILE_TITLE_TAKEN`.
- Limits accepted: k6, the app, Postgres and ClamAV share one Windows machine under Docker
  Desktop, so absolute numbers say little about EKS; the comparison between levels is the
  result. One app process, `STORAGE_DRIVER=local`, throttling off. k6's documentation does not
  say how its cookie jar treats `SameSite`; the smoke run's successful refreshes show the
  `SameSite=Strict`, `Path=/auth/token` cookie is sent.
- The load levels (Phase 2) are still to be run and recorded here.

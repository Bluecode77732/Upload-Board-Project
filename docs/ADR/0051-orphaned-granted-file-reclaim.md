# ADR 0051: Reclaim Orphaned `granted_` Files — DB-Joined Sweep, Report-First Default

- Status: Accepted — implemented (report-only; deletion stays behind `GRANTED_SWEEP_DRY_RUN`)
- Date: 2026-09-05
- Extends: [ADR 0018](0018-orphan-temp-file-cleanup.md) (temp-file sweep), [ADR 0029](0029-storage-port-adapter.md) (`FileStorage` port), [ADR 0020](0020-account-deletion-cascade.md) (best-effort post-commit unlink)
- 한국어: [0051-orphaned-granted-file-reclaim.ko.md](0051-orphaned-granted-file-reclaim.ko.md)

## Context

Physical deletion of a granted file (`file/upload/granted_...`) is post-commit and
best-effort ([ADR 0020](0020-account-deletion-cascade.md)): `unlinkStoredFiles`/
`storage.unlink()` runs after the owning DB row is already gone, and a failure is only
logged at `warn`, never retried. [ROADMAP.md](../ROADMAP.md) (the "Reclaiming orphaned
`granted_` files" entry, recorded 2026-07-30) names two concrete leak paths — a failed
unlink, and a file inserted between the path read and the cascade delete — and explicitly
rejects copying [ADR 0018](0018-orphan-temp-file-cleanup.md)'s temp sweep verbatim: a
`temp_` file's orphan status is decidable from its prefix and `mtime` alone (nothing
outside `file/temp` ever reads it once promoted), but a `granted_` file's orphan status is
not decidable from the filesystem alone — it requires a join against `file_entity.filePath`.
That gap is why ROADMAP explicitly deferred this with "needs a DB-joined reconciliation
with its own ADR" instead of scheduling it as a copy of ADR 0018.

**Measurement attempted, inconclusive.** Before drafting this ADR, an attempt was made to
measure the real current orphan count (`file/upload/` has 44 objects, 129MB, as of
2026-09-04). The local `db` container had no pre-existing volume — `docker compose up -d
db` had to create one from scratch, and `pnpm migration:show` confirmed every migration
unapplied on it. There is no historical DB state in this environment to join against those
44 files; against an empty schema they would trivially all read as orphans, which is not a
real signal. The design below does not depend on that count — it must be correct for
whatever the real count turns out to be once run against a live database with history.

**Port gap.** `FileStorage` ([ADR 0029](0029-storage-port-adapter.md)) has `listTemp()`
(added specifically for ADR 0018's sweep) but nothing equivalent for granted objects —
unsurprising, since ADR 0018 never needed a DB join and so never needed to enumerate
`file/upload`. Both adapters (`LocalDiskStorage`, `S3Storage`) need a new method.

## Decision

### D1 — New port method: `listGranted()`

```
listGranted(): Promise<StorageTempEntry[]>   // { key: string; mtimeMs: number }
```

Reuses `StorageTempEntry` rather than introducing a second, identically-shaped type — an
earlier draft split out a `StorageGrantedEntry` on the reasoning that "a granted entry and
a temp entry mean different things," but they carry the exact same two fields with no
structural difference, so a second interface was pure duplication for no type-safety gain.
`StorageTempEntry`'s doc comment now names both consumers. `LocalDiskStorage.listGranted()`
reads `file/upload` (mirroring `listTemp()`'s `readdir` + `stat` over `file/temp`, filtering
`granted_`-prefixed entries, returning the key as the full `file/upload/granted_...`
string — the exact string `FileEntity.filePath` already stores, so the diff in D3 is a
plain string-set membership check, no transform needed). `S3Storage.listGranted()` lists
the `granted/` physical prefix and reverses `toS3GrantedKey`'s mapping back to the logical
`file/upload/granted_...` form, the same shape `listTemp()` already reverses for `temp/`.

### D2 — Module placement: inside `FileModule`, not a separate module

**Corrected from an initial draft.** The first version of this ADR proposed a new
operational module, `GrantedCleanupModule`, mirroring `TempCleanupModule`'s shape
(`imports: [StorageModule, MetricsModule]`, its own `OnModuleInit` cron registration).
On reconsideration that precedent doesn't actually transfer: `TempCleanupModule` and
`StorageModule` are operational modules because they are cross-cutting infrastructure
with **no domain data of their own**, consumed by *multiple* domain modules — that is
exactly what justifies giving them a module no single domain owns. This sweep is the
opposite shape: its entire job is reconciling **`FileModule`'s own entity** against disk,
and `FileModule` already has everything it needs wired in —
`TypeOrmModule.forFeature([FileEntity, UserEntity])`, `StorageModule`, `MetricsModule`
(`file.module.ts`). A separate module would have duplicated that wiring for a sweep that
serves no consumer outside `FileModule` — it is `FileModule`'s own maintenance concern,
not a shared cross-cutting one.

**Decision.** `GrantedCleanupService` is an **unexported** provider inside `FileModule`
(`providers: [FileService, GrantedCleanupService]`) — not folded into `TempCleanupModule`
(that module's `TempCleanupService` has zero DB access by design, ADR 0018/0029, and this
sweep's defining operation is exactly the DB join that design deliberately excludes), and
not routed through `FileService`'s exported methods either: an orphan by definition has no
row at all, so no ownership/visibility judgment from `FileService` ever applies to it — it
only needs the set of `filePath` values that currently exist. `GrantedCleanupService`
therefore injects `Repository<FileEntity>` directly via the `TypeOrmModule.forFeature`
`FileModule` already declares (the same cross-module repository-injection pattern
`AuthModule` uses for `UserEntity` alongside importing `UserModule` for actual business
logic, `auth.module.ts:6,14` — except here there isn't even a cross-module boundary to
cross, since the entity is already `FileModule`'s own) and queries only the `filePath`
column (`find({ select: ['filePath'] })`) — read-only, no write path exists here.

### D3 — Orphan definition and the promotion race

A candidate is a `listGranted()` entry whose key is **not** in the current set of
`file_entity.filePath` values **and** whose `mtimeMs` is older than a minimum-age floor.

The floor exists because `FileService.uploadFile`'s `storage.promote()` call runs
*inside* its QueryRunner transaction, before `commitTransaction()` (Transaction Boundary
table) — the physical rename (or S3 copy+delete) can complete a moment before the DB row
becomes visible to any other connection. A sweep that ran in that exact window would see
a granted key with no matching row yet and misclassify a legitimate, mid-flight
promotion as an orphan. This is the same shape of problem ADR 0018's TTL solves, inverted:
that TTL is a maximum age a temp file may reach before being deleted; this is a *minimum*
age a disk-only granted key must reach before being *considered* orphaned at all, sized
generously against `promote()`'s typical sub-second duration, the same "generous enough
that a slow-but-genuine claim is never reaped" reasoning ADR 0018 used for its own 24h
TTL. Unlike that TTL, this floor is **not** exposed as config — a corrected earlier draft
had a `GRANTED_SWEEP_MIN_AGE_MINUTES` env var, but reconsidered: `TEMP_SWEEP_TTL_HOURS`
really is an operational judgment call (how long to tolerate an abandoned upload is a
business decision an operator might reasonably want to change), while this floor is a
race guard against a fixed, sub-second internal operation — nothing in this codebase
(including its own tests) ever needs a different value, so it is a `MIN_AGE_MS` constant
in `granted-cleanup.service.ts` (1 hour) rather than a config surface with no real use.

A pure selector, `selectOrphanedGrantedFiles(candidates, knownFilePaths, now, minAgeMs)`,
mirrors `selectExpiredTempFiles`'s shape (ADR 0018) — unit-testable with no DB or
filesystem; `minAgeMs` stays a parameter here even though its only caller passes a
constant, so the race-guard boundary itself is still independently testable.

### D4 — Dry-run-first default, diverging deliberately from ADR 0018's default

`GRANTED_SWEEP_DRY_RUN` defaults to **`true`** — the opposite of `TEMP_SWEEP_DRY_RUN`'s
default `false`. Temp-file deletion is years-established and low-risk (an unclaimed
upload has no other owner or reference). Granted-file deletion is new, and a
false-positive here destroys a real user's permanently-owned file — matching
CLAUDE.md's Scope Discipline stance on permanent deletion paths ("describe the cascade
depth and confirm the operation is intentionally irreversible before writing any code"),
this sweep ships **reporting only** by default: it runs on schedule, computes candidates,
logs them and records a metric, but never calls `storage.unlink()` until an operator
reviews that signal over time and explicitly sets `GRANTED_SWEEP_DRY_RUN=false`. One code
path serves both modes — flipping the flag is the only change needed to go from
"reports" to "deletes," identical to how `TempCleanupService.sweep()` already branches
on its own dry-run flag.

### D5 — Config (Joi + `.env.example`, mirroring the `TEMP_SWEEP_*` block)

- `GRANTED_SWEEP_ENABLED` (bool, default `true`)
- `GRANTED_SWEEP_CRON` (string, default `'0 3 * * *'` — daily, not hourly: the DB join
  is heavier than a bare `readdir`, and a granted-file leak accumulates far slower than
  an abandoned temp upload)
- `GRANTED_SWEEP_DRY_RUN` (bool, default `true` — see D4)

(The promotion-race age floor is a `MIN_AGE_MS` constant, not a config var — see D3.)

`test/e2e-env.ts` gets `GRANTED_SWEEP_ENABLED = 'false'`, the same reason
`TEMP_SWEEP_ENABLED` is forced off there: e2e boots a real DB and must not race a
background cron against its own fixtures.

### D6 — Metrics (extends [ADR 0047](0047-observability-prometheus-grafana.md))

**One labeled counter**, `granted_cleanup_sweep_total` (`labelNames: ['outcome']`) —
**not** two separate counters. An earlier draft registered
`granted_cleanup_candidates_total` and `granted_cleanup_deleted_total` as independent
`Counter`s, mirroring `temp_cleanup_deleted_total`'s unlabeled shape; reconsidered,
because `MetricsService` already has the closer precedent for exactly this
shape — `upload_claims_total`, one counter labeled `outcome: 'fresh' | 'replayed'` for a
single event with multiple outcomes (`file.service.ts`). This sweep is the same shape:
one event (a sweep run), two possible outcomes per orphaned key found —
`inc({ outcome: 'candidate' }, orphaned.length)` on every run including dry-run (in
report-first mode this outcome *is* the feature's entire signal, so it must be visible or
the default mode ships blind), and `inc({ outcome: 'deleted' }, deleted)` only when
`storage.unlink()` actually ran.

## Alternatives rejected

- **Always-auto-delete, no dry-run** — rejected outright: a false-positive is
  unrecoverable data loss on a file a real user owns, and the developer explicitly
  rejected this mode when asked.
- **On-demand only, no cron** — considered as the safest-feeling option, but rejected in
  favor of the scheduled report: an unattended, safe-by-default report is exactly what
  builds the confidence needed before anyone flips the dry-run flag, and the mechanism
  costs nothing extra to also expose on a schedule.
- **A dedicated `GrantedCleanupModule`** — the design this ADR first proposed, rejected on
  reconsideration (D2): the operational-module precedent (`TempCleanupModule`,
  `StorageModule`) exists for cross-cutting infrastructure with no domain data of its own,
  shared by multiple modules. This sweep's whole job is reconciling `FileModule`'s own
  entity — a separate module would only have duplicated wiring `FileModule` already has,
  for a sweep with no consumer outside it.
- **Fold into `TempCleanupModule`** — rejected (D2): mandate mismatch, and it would give
  that deliberately DB-free module a DB dependency it does not otherwise need.
- **Route the DB read through `FileService`** — rejected (D2): stretches `FileModule`'s
  stated two-method export contract for a consumer that contract was never meant to serve.
- **A composite check inside `FileService.deleteFile`/`deleteFilesOfCreator` instead of a
  separate sweep** — rejected: those paths already do the best-effort unlink `synchronously,
  post-commit; the leaks this ADR targets are exactly the cases where that unlink already
  failed or raced. A separate, later-running reconciliation is the only way to catch what
  the inline attempt already missed.

## Consequences

- `FileStorage` interface gains `listGranted()`, reusing `StorageTempEntry`; both
  `LocalDiskStorage` and `S3Storage` implement it — the ISP precedent from ADR 0029
  continues (a change to the shared port ships with both real implementations, not a stub).
- No new module: `GrantedCleanupService` is an unexported provider inside `FileModule`
  (D2); `AppModule` is unchanged by this ADR.
- Three new Joi schema entries + `.env.example` entries (D5 — `ENABLED`/`CRON`/`DRY_RUN`
  only; the promotion-race age floor is a code constant, not a fourth env var);
  `test/e2e-env.ts` gains one line.
- One new labeled Prometheus counter (D6), scraped like every other `MetricsService`
  counter — no new `ServiceMonitor` config needed (ADR 0047's already covers `/metrics`).
- **Default behavior ships inert with respect to deletion**: until an operator explicitly
  sets `GRANTED_SWEEP_DRY_RUN=false`, this ADR adds observability only, not a new deletion
  path — see the Addendum below for what happened when that flag *was* flipped during this
  ADR's own live verification.
- CLAUDE.md updates in the same change: a Module Responsibility note under `FileModule`
  (not a new module bullet), a new concern-to-entrypoint map row, an Architecture
  Decisions > File Storage note. ROADMAP.md's "Reclaiming orphaned `granted_` files"
  entry is marked settled, pointing here.
- Residual, accepted: the minimum-age floor (D3) is a heuristic, not a guarantee — an
  exceptionally slow `promote()` call (well past the `MIN_AGE_MS` constant) could still
  be misread as orphaned in the same narrow window ADR 0018 already accepts for its own
  TTL reasoning. In report-first mode this only affects a log line and a counter, not
  a deletion, until dry-run is turned off.

### Addendum (2026-09-05) — live-verifying this ADR's own design deleted 44 real files

Manually verifying `GrantedCleanupService.sweep()` end to end (real DB, real disk,
`GRANTED_SWEEP_DRY_RUN=false`) was run against this repo's actual `file/upload/` — the
same directory this ADR's Context measured at "44 objects, 129MB" while noting the local
DB had no history to join against. That gap didn't just make the *measurement*
inconclusive, as recorded above — it made the directory unsafe to run a live delete
against at all: with zero `file_entity` rows in the DB at the time, every one of those
44 objects read as an orphan by the same logic D3 describes, and `sweep()` correctly
deleted all of them. `file/upload/` was confirmed never git-tracked
(`git ls-files -- file/upload` empty) and `fs.unlink` bypasses the Recycle Bin, so there
was no recovery path; the deleted files turned out to be disposable test data, which the
developer confirmed after the fact — luck, not a property of how the verification was run.

This wasn't a defect in the shipped design — `GRANTED_SWEEP_DRY_RUN` defaulting `true`
is exactly the safeguard that would prevent this in a real deployment. It was a gap
between what this ADR's own Context documented as a risk and what the verification
process actually checked for before calling the live-delete path. A second verification
run, isolated to a sandbox directory (`process.chdir()` before constructing the storage
adapter), passed cleanly with no side effects. The general rule this incident produced —
never live-test a sweep/reclaim service against this repo's real `file/temp`/`file/upload`
— is now recorded in [CLAUDE.md](../../CLAUDE.md) under Commands, so it applies to any
future sweep-style service, not just this one.

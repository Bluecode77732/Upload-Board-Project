# ADR 0018: Scheduled Orphan Temp-File Cleanup

- Status: Accepted
- Date: 2026-07-26
- 한국어: [0018-orphan-temp-file-cleanup.ko.md](0018-orphan-temp-file-cleanup.ko.md)

## Context

The two-phase upload contract ([ADR 0003](0003-two-phase-upload-contract.md)) writes
`file/temp/temp_{uuid}_{ts}.{ext}` on `POST /upload/attach`, and promotion (`POST /file`)
**renames the file out of `file/temp`** into `file/upload/granted_...`. Therefore anything
left in `file/temp` with a `temp_` prefix is, by definition, unclaimed — no DB lookup is
needed to identify it. When a client attaches a file but never calls `POST /file`, that
`temp_` file lingers forever. ADR 0003's Consequences flagged this as "no cleanup job yet
— a candidate roadmap item"; it is the only unmanaged resource leak in the system
(ROADMAP Stage 2). Left unbounded, abandoned 100 MB uploads reopen the upload-based
denial-of-service surface that the 100 MB size cap ([ADR 0005](0005-local-disk-storage.md))
was meant to bound.

## Decision

An **in-app scheduled sweep** deletes expired orphan temp files.

- **Mechanism — `@nestjs/schedule` (MIT).** A new runtime dependency. `cron@4.4.0` (the
  transitive engine `@nestjs/schedule` resolves) is promoted to a **direct** dependency so
  backend code can import `CronJob` under pnpm's strict linking — the same
  phantom-transitive promotion precedent as `multer`. `pnpm audit --prod` introduced no new
  advisory from either package.
- **Imperative registration**, not the `@Cron` decorator. `TempCleanupService.onModuleInit`
  builds the job with `CronJob.from({ cronTime, onTick, waitForCompletion })` and registers
  it via `SchedulerRegistry.addCronJob`. Rationale: the schedule string comes from config
  (a decorator argument is fixed at class-definition time, before DI exists), and when the
  feature is disabled the job is **not registered at all** rather than registered-and-inert.
- **New module `TempCleanupModule`** (`backend/temp-cleanup/`), an *operational /
  cross-cutting* module — **not** a domain module. This amends the module policy ("new
  modules only when a new domain arrives") to admit operational modules. It was chosen over
  adding a service to `UploadModule`, which is deliberately controller-only; keeping that
  purity was preferred to the tighter data-cohesion of co-locating the sweep with the
  `file/temp` writer (Principle Conflict Protocol: SRP/cohesion vs. the local
  "UploadModule has no service" rule — resolved by a documented policy amendment).
- **Safety (irreversible-delete discipline).** Only entries in `file/temp` whose name
  starts with `temp_` and whose `mtime` age exceeds the TTL are deleted. `granted_` files
  and `file/upload` are never candidates. The `temp_` prefix is guarded twice: the service
  skips non-`temp_` names before it even `stat`s them, and the pure `selectExpiredTempFiles`
  selector re-checks the prefix. All I/O is `fs/promises` (no sync blocking); unlinks are
  batched (bounded parallelism); a per-file `unlink` failure is logged and does not abort
  the sweep; an absent `file/temp` (`ENOENT`) is a silent no-op; a `TEMP_SWEEP_DRY_RUN`
  mode logs the targets without deleting.
- **Config (Joi + `.env.example`), all with safe defaults:**
  `TEMP_SWEEP_ENABLED` (bool, `true`), `TEMP_SWEEP_CRON` (string, `'0 * * * *'` — hourly),
  `TEMP_SWEEP_TTL_HOURS` (number, `24`), `TEMP_SWEEP_DRY_RUN` (bool, `false`). The e2e boot
  sets `TEMP_SWEEP_ENABLED=false` so the cron never registers during tests.
- **TTL 24 h.** Generous enough that a slow-but-genuine `attach → POST /file` is never
  reaped mid-claim; the hourly sweep bounds worst-case residency to ≈ 25 h. No schema
  change — the filesystem prefix + `mtime` fully identify orphans.

## Alternatives rejected

- **Opportunistic sweep on `POST /upload/attach`** — no dependency, but performs no cleanup
  without upload traffic, and would add a service to the deliberately controller-only
  `UploadModule`.
- **Manual / external-cron `pnpm` script** — no dependency, but relies on an external
  scheduler that does not exist yet (no deploy pipeline); defers the leak until Stage 4.
- **`@Cron` decorator (declarative)** — cannot take an env-driven schedule and cannot skip
  registration when disabled; both are requirements here.
- **Sweep inside `UploadModule`** — highest data-cohesion (it owns `file/temp`), but breaks
  "UploadModule has no service"; rejected to keep that module controller-only.
- **DB-backed orphan tracking** — unnecessary: the `temp_` prefix + `mtime` already identify
  orphans, so no `FileEntity` state or schema change is needed.

## Consequences

- `@nestjs/schedule` and `cron` are new runtime dependencies (both MIT). `ScheduleModule.forRoot()`
  is added to `AppModule` (a global scheduler now runs in-process).
- **Module policy amended**: operational / infra cross-cutting modules (like
  `TempCleanupModule`) are now a sanctioned exception to "new modules only for new domains."
  CLAUDE.md's Module Responsibility and Two-Phase Upload Contract sections are updated.
- ADR 0003's "no cleanup job yet" consequence is resolved.
- In a future multi-instance deployment (Stage 4), every instance would run the cron; the
  sweep is idempotent (a second instance simply finds nothing to delete), but de-duplication
  — or moving the sweep to an orchestrator-level scheduled task — becomes a Stage 4 concern.
- Structured metrics / alerting on sweep volume are out of scope (Stage 4 observability).

# ADR 0061: Graceful Shutdown — `enableShutdownHooks()`, and Node as PID 1

- Status: Accepted — implemented, verified in a local Linux container (not on Kubernetes)
- Date: 2026-09-21
- Extends: [ADR 0030](0030-container-non-root-and-arch-stance.md) — the container shape this was measured against (non-root, `CMD ["node", "dist/main"]`); none of it changes
- 한국어: [0061-shutdown-hooks-and-pid1-sigterm.ko.md](0061-shutdown-hooks-and-pid1-sigterm.ko.md)

## Context

`backend/main.ts` never called `app.enableShutdownHooks()` (zero hits in `backend/` and
`test/`). CLAUDE.md's Known Gaps recorded that on 2026-09-16 and deferred it to the next
redeploy: every write is a single-request transaction, so an abrupt kill can't corrupt data
(Postgres rolls back a dropped connection), and nothing was deployed for it to matter
against. That entry also said "On SIGTERM the process just dies."

Measuring it on 2026-09-21 showed the last sentence was wrong, and that the cost was larger
than an unclean pool. Against the `production` image built from `53dd4a5` (Docker Desktop
28.5.1, linux/amd64, `node` as PID 1, `--stop-timeout 10` to match Compose's default),
`docker stop` took 10.4 s and the container exited 137. Docker's event stream shows SIGTERM
at +0 ms and SIGKILL at +10,014 ms. A `--require` probe that registers no signal handler
logged neither a `pg.Pool.end()` call nor an `exit` event — the process ran no shutdown code
and never left on its own.

Why: `node` is the init process of the container's PID namespace, and such a process only
receives signals it has installed a handler for (`pid_namespaces(7)`). Node installs its own
SIGTERM/SIGINT handler — the baseline `/proc/1/status` already shows SIGTERM as caught — but
as I read Node's source that handler resets the terminal and re-raises the signal with the
default disposition, which init discards. So SIGTERM did nothing; the process lived until the
grace period ran out and SIGKILL, the one signal that can't be discarded, ended it.

On Kubernetes the same PID 1 rules apply, and `k8s/helm/templates/deployment.yml` sets no
`terminationGracePeriodSeconds`, so I expect a rolling update to wait the 30-second default
per pod. That is inference — nothing is deployed to measure it.

## Decision

### D1 — Call `app.enableShutdownHooks()` in `bootstrap()`, right before `app.listen()`

A plain call: no options, default signals. Nest now listens for SIGTERM/SIGINT (and the rest
of `ShutdownSignal`) and runs the `OnModuleDestroy`/`BeforeApplicationShutdown`/
`OnApplicationShutdown` hooks. The two that matter already existed and needed no code:
`TypeOrmCoreModule.onApplicationShutdown` (`dataSource.destroy()`, which ends the pg pool) and
`@nestjs/schedule`'s `SchedulerOrchestrator.beforeApplicationShutdown` (deletes every job in
`SchedulerRegistry`, including the two that `TempCleanupService`/`GrantedCleanupService`
register with `addCronJob`).

### D2 — No `OnModuleDestroy` added anywhere

I read each candidate for something that outlives `app.close()`:

- The two sweep crons — stopped by the scheduler hook above.
- `ScanService` — `clamscan` is initialised with `bypassTest: true`, so `init()` opens no
  connection; each scan opens and ends its own socket.
- `S3Storage` — its `S3Client` is never destroyed. I did not exercise it: `S3Storage` has
  never run against a live bucket (ADR 0029), and I expect the SDK's keep-alive sockets not to
  hold the process open — expect, not measured.

Nothing showed a leak, so nothing was added. Revisit when `STORAGE_DRIVER=s3` goes live.

### D3 — Keep the plain call; `{ useProcessExit: true }` is the recorded fallback

Nest's cleanup ends with `process.kill(process.pid, signal)`: it re-sends the signal to
itself after removing its own listeners. As PID 1 that self-sent signal is discarded like any
other, so it does nothing. The process leaves only because, once `app.close()` is done, the
event loop is empty — which is also why the exit code is 0 rather than 143.

Measured with a probe variant that adds one ref'd `setInterval` (standing in for any handle
that outlives cleanup): the hooks still ran (`pg.Pool.end()` logged) but the process did not
exit — `docker stop` took 10,337 ms and ended 137. The plain call is correct only as long as
nothing keeps the loop alive after cleanup.

The option that removes that condition is `enableShutdownHooks([], { useProcessExit: true })`,
present in the installed `@nestjs/core` 11.1.28: after cleanup it calls `process.exit(0)`
instead of re-raising. I did not measure it (from reading
`NestApplicationContext.listenToShutdownSignals` it is deterministic).

Not chosen: the plain form is what the deferral named, it meets the goal today,
`process.exit` would also cut off anything the hooks failed to close, and if a handle does
leak later the failure is the same 10 s/30 s-then-SIGKILL that exists today — not worse. If
that happens, add the option.

## Consequences

Measured with the same procedure and `--stop-timeout 10` throughout:

| | `docker stop` | exit code | signals Docker sent | probe |
|---|---|---|---|---|
| before (`53dd4a5`) | 10,388 / 10,427 ms | 137 | SIGTERM +0, SIGKILL +10,014 ms | no `Pool.end()`, no `exit` |
| after, plain call | 439 / 324 ms | 0 | SIGTERM +0, exit +252 / +183 ms | `Pool.end()`, then `exit` code 0 three ms later |
| after + ref'd timer (experiment) | 10,337 ms | 137 | SIGTERM +0, SIGKILL +10,015 ms | `Pool.end()`, no `exit` |

- The pg pool is now closed by the application, and a container stop takes under half a
  second instead of the whole grace period. On Kubernetes I expect the same for rolling
  updates and scale-in — not measured.
- `pg_stat_activity` can't tell before from after: the kernel closes a SIGKILLed process's
  sockets, so the count is 0 within the window either way. The probe's `Pool.end()` line is
  the evidence.
- e2e can't cover this: `app.close()` already ran the hooks there (`teardownE2E`), and the
  signal listeners are the only thing this adds. It needs a real signal, so it was checked by
  hand in a container. There is no automated regression check; the ref'd-timer row above is
  what a regression would look like.
- Not measured: requests in flight during shutdown, `S3Storage`, Kubernetes itself.
- Method limits: local Docker only; an empty throwaway database on the Compose `db` service;
  sweeps disabled; no volume mounted; `STORAGE_DRIVER=local`; no AWS credentials passed. This
  Docker Desktop reports `StopTimeout=1` even for a stock container, hence the explicit
  `--stop-timeout 10`. The probe was a throwaway preload and is not committed.
- No schema, Joi, `.env.example`, guard, or Swagger change.
- CLAUDE.md's 2026-09-16 Known Gaps entry is closed, and its "the process just dies" line
  corrected.

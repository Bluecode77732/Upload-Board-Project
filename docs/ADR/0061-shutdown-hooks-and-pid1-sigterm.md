# ADR 0061: Graceful Shutdown — `enableShutdownHooks()`, and Node as PID 1

- Status: Accepted — implemented, verified in a local Linux container and on a local `kind` cluster (not on EKS); D3 reversed by the addendum
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

*Reversed later the same day — see the addendum at the end. The option was measured and
adopted.*

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

### Addendum (2026-09-21, later the same day) — `useProcessExit: true` adopted, verified on a local `kind` cluster

D3 left `useProcessExit: true` as an unmeasured fallback. Measuring it settled the question,
so the call is now `app.enableShutdownHooks([], { useProcessExit: true })`. This replaces
D3's conclusion, and the "Kubernetes itself" item under "Not measured" above (a local `kind`
cluster is now measured; EKS is not).

Same images and probe throughout; plain versus the option, each with and without the ref'd
timer:

| | plain | `useProcessExit: true` |
|---|---|---|
| Docker, normal | 385 ms, exit 0 | 422 ms, exit 0 |
| Docker, timer left running | 10,400 ms, 137 (SIGKILL at +10,033 ms) | 409 ms, exit 0 |
| `kind` pod, normal | 1,187 ms, `exit` event code 0 | 460 ms, code 0 |
| `kind` pod, timer left running | 30,568 ms, no `exit` event (SIGKILL after the grace period) | 412 ms, code 0 |

Docker rows are `docker stop` with `--stop-timeout 10`. `kind` rows are the time from
`kubectl scale --replicas=0` until the pod object is gone, so they include kubectl and
kubelet overhead. The pod spec carries `terminationGracePeriodSeconds: 30` — the chart sets
none, so that is Kubernetes' default, read back from the running pod rather than assumed.

Why switch: the failure D3 accepted is silent and nothing automated catches it. Plain drifts
back to a full grace-period wait the day anything keeps the event loop open — `S3Storage`
going live is the likeliest candidate — and the only symptom is slower deploys. With the
option the exit no longer depends on that. In every option row the probe logged
`pg.Pool.end()` before the `exit` event, so the pool close and the cron stop still run first.

What it costs, accepted: `process.exit(0)` ends the process even if a handle was left open,
so a leaked handle no longer shows up as a slow shutdown; and the exit code is always 0
(Kubernetes doesn't care).

Method: `kind` v0.27.0 (Kubernetes v1.32.2) with a kubeconfig file of its own, so no real
cluster context was visible to `kubectl`/`helm`; the chart at `k8s/helm` from HEAD installed
with `helm install` (migration hook included; `clamav` scaled to 0 afterwards, the chart has
no toggle for it); a throwaway Postgres pod; generated secrets; locally built images loaded
with `kind load`. The probe was mounted from a ConfigMap and enabled through `NODE_OPTIONS`.
The terminated container's exit code could not be read back — kubelet had already
garbage-collected it — so the probe's `exit` event stands in: present means the process left
on its own, absent means SIGKILL.

Still not measured: EKS and the ALB, requests in flight during shutdown. The two checks that
need a live cluster — pods leaving `Terminating` within a second or two under the production
values (`STORAGE_DRIVER=s3`), and no `502`/`503`/`504` from the ALB during a rolling update —
are listed with pass criteria in the pending list under "Enabling HTTPS (Ingress)" in
`k8s/helm/README.md`. The second is the one likely to fail: before this change a pod ignored
SIGTERM and kept running until SIGKILL, which (inference, not measured) outlasted the ALB's
deregistration lag by accident; now it exits within a second, so a request routed to it in
that lag can be refused. The addendum below closes `S3Storage` and tests the `preStop` remedy's
mechanism, but not against a real ALB.

### Addendum (2026-09-22) — `S3Storage`, and the `preStop` mechanism, tested in isolation

Two of the "Still not measured" items above turned out to be directly testable without a live
cluster or real AWS access.

**`S3Storage`'s `S3Client`.** `@aws-sdk/client-s3`'s default request handler builds its agent as
`new https.Agent({ keepAlive: true, maxSockets, ... })` — confirmed by reading
`@smithy/node-http-handler`'s bundled source, not assumed. A `keepAlive` agent leaves a ref'd
socket in its pool after a response completes, exactly the kind of handle D2 flagged as
unverified. A Docker-only probe reproduced that mechanism with a plain `http.Agent({ keepAlive:
true })` against a local server (no TLS, no AWS network, no credentials) and left the socket
open on purpose: `docker stop` still took 386 ms, exit 0, `pg.Pool.end()` and the `exit` event
both logging as expected. This generalizes the ref'd-timer result in the first addendum to the
concrete handle shape `S3Client` actually uses; D2's "re-check when `STORAGE_DRIVER=s3` goes
live" item is closed as far as shutdown speed goes. Not tested: an actual `S3Client` instance
or a real request to S3.

**The `preStop`/`terminationGracePeriodSeconds` mechanism.** On the same local `kind` cluster as
before, `kubectl patch` added a `lifecycle.preStop.exec` and a `terminationGracePeriodSeconds`
to the running Deployment (not committed to the chart — this tests the mechanism, not a chosen
duration). Two runs, `kubectl get events -o json` and an absolute-timestamp probe cross-checked
against each other:

- **Grace covers the sleep** (`preStop: sleep 5`, grace 35 s): scale-down to pod-gone took
  5.7 s. SIGTERM arrived only once the sleep finished, then the app exited in well under a
  second — the mechanism the ADR's Pending note assumed, confirmed.
- **Grace is shorter than the sleep** (`preStop: sleep 40`, grace still 35 s — deliberately
  insufficient): `FailedPreStopHook` fired at exactly the 35 s grace boundary, and kubelet sent
  SIGTERM to the main process **at that same moment** (10 ms later, by the probe's own
  timestamp) rather than never sending it. The app still exited cleanly — `pg.Pool.end()`, then
  `exit` code 0 — about 0.5 s after that. Total time to pod-gone: 36.4 s, essentially the full
  grace period, not the 5 s the (never-completing) preStop hook was written for.

This corrects the inference in the paragraph above and in `k8s/helm/README.md`'s pending list,
both written before this was measured: on this `kind`/containerd combination, an
under-provisioned `terminationGracePeriodSeconds` cost deploy *time* (the rollout waits out the
whole grace period), not an unclean SIGKILL of the app — because kubelet still delivered
SIGTERM once it gave up on the stuck hook, and the app was fast enough to catch it. Whether EKS
containerd behaves the same, and — the actual open question — whether the ALB stops routing to
a pod before its grace period (however long) runs out, are both still unverified. `docker
stop`'s own grace/SIGKILL semantics (used throughout this ADR's other measurements) has no
`preStop` equivalent, so this pair of scenarios could only be run on `kind`.

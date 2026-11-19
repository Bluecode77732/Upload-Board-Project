# perf/

> 한국어 버전: [README.ko.md](README.ko.md)

Hand-run measurement tools. Nothing here is wired into CI, and nothing here may touch the dev
database, the compose volumes, or the repo's `file/` directory.

| File | What it does | Decision |
|---|---|---|
| `perf-db.js` | Connection helper for the throwaway perf database | [ADR 0049](../docs/ADR/0049-performance-capacity-criteria.md) |
| `seed.js` | 50 users, 10,000 files, 10,000 posts, two content files, plus the k6 accounts (`perf-vu-0..2000`, `perf-partner-1..2000`) and one private 1KB file per VU | ADR 0049, [ADR 0069](../docs/ADR/0069-k6-load-testing.md) |
| `explain.js` | `EXPLAIN (ANALYZE, BUFFERS)` on the six list queries | ADR 0049 |
| `load-test.js` | autocannon against eight fixed endpoints, compared with ADR 0049 D1 | ADR 0049 |
| `k6/load.js` | Mixed user and admin load at one VU level, counting designed rejections apart from failures | ADR 0069 |
| `k6/throttle.js` | Checks the 5/min and 100/min throttle boundaries | ADR 0069 |

## Environment

Everything runs in a sandbox directory outside the repo (the examples use `$SB`). The app,
the migrations and the seed all resolve `.env`, `file/temp` and `file/upload` from the current
directory, so running them from `$SB` keeps the repo's `.env` and `file/` out of it.

1. Throwaway containers. They hold nothing worth recovering.

   ```bash
   docker run -d --name sharenpo-perf-db -e POSTGRES_USER=perf -e POSTGRES_PASSWORD=perf \
     -e POSTGRES_DB=perf -p 5436:5432 postgres:16
   docker run -d --name sharenpo-perf-clamav -p 3311:3310 clamav/clamav:stable  # signatures take a few minutes
   ```

2. `$SB/perf.env`, exported before every command below. Generate both token secrets fresh
   (at least 32 characters with lowercase, uppercase, a digit and a symbol); never copy the
   repo's `.env`.

   ```bash
   export ENV=dev DB_TYPE=postgres DB_HOST=127.0.0.1 DB_PORT=5436 DB_USERNAME=perf \
     DB_PASSWORD=perf DB_DATABASE=perf PERF_DB_DATABASE=perf HASH_ROUNDS=10 \
     ACCESS_TOKEN_SECRET=... REFRESH_TOKEN_SECRET=... \
     ACCESS_TOKEN_SECRET_EXPIRES_IN=180 REFRESH_TOKEN_SECRET_EXPIRES_IN=86400 \
     STORAGE_DRIVER=local CLAMD_HOST=127.0.0.1 CLAMD_PORT=3311 \
     TEMP_SWEEP_ENABLED=false GRANTED_SWEEP_ENABLED=false THROTTLE_ENABLED=false
   ```

   `ENV=dev` matters: under `prod` the refresh cookie is `Secure` and is not sent over http.

3. Schema, seed and app, from `$SB`, with `R` set to the repo root. This uses the compiled
   `dist/`, so build first if the backend changed.

   ```bash
   cd "$SB" && source perf.env && mkdir -p file/temp
   node "$R/node_modules/typeorm/cli.js" migration:run -d "$R/dist/data-source.js"
   node "$R/perf/seed.js"
   node "$R/dist/main.js" > app.log 2>&1 &
   ```

## k6

k6 runs as the `grafana/k6:2.3.0` image (AGPL-3.0; a separate process, never a pnpm
dependency). The repo is mounted read-only because `load.js` reads
`backend/common/error-code.ts`; results go to `$SB/results`. On Git Bash, prefix the command
with `MSYS_NO_PATHCONV=1`.

```bash
docker run --rm -v "$R:/repo:ro" -v "$SB/results:/results" \
  -e TARGET_VUS=10 -e RAMP=10s -e HOLD=2m -e LABEL=smoke \
  grafana/k6:2.3.0 run --quiet /repo/perf/k6/load.js
```

- One level per run: `TARGET_VUS`, `RAMP`, `HOLD` (3m per level), `LABEL` names the result
  files. VU `n` uses `perf-vu-n`, so `TARGET_VUS` cannot exceed the seeded 2000.
- Recovery right after a load run: `-e TARGET_VUS=10 -e RAMP=0s -e HOLD=60s -e LABEL=<level>-recovery -e BASELINE=/results/smoke.json`.
  The summary prints PASS when p95 is at most twice the smoke p95.
- A run passes when `unexpected_failure` and `unplanned_response` are both 0; k6 exits 99
  otherwise. `designed_rejection` counts are expected.
- Throttle check: restart the app with `THROTTLE_ENABLED=true`, then
  `grafana/k6:2.3.0 run --quiet /repo/perf/k6/throttle.js` with the same mounts. Restart it
  with `false` before the next load run.

The database is not reset between levels; each level runs on what the previous ones left.

## autocannon

```bash
cd "$SB" && source perf.env && node "$R/perf/load-test.js"
```

Logs in as `perf-seed-0@example.test` and reports `PASS` only when the latency targets hold and
`non2xx`, `errors` and `timeouts` are all 0.

## Cleanup

```bash
docker rm -f -v sharenpo-perf-db sharenpo-perf-clamav
```

Then stop the app (check `netstat -ano | grep :3000` and kill only the PID you identified) and
delete `$SB`.

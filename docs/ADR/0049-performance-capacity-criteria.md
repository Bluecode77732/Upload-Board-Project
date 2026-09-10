# ADR 0049: Performance and Capacity Criteria

- Status: Accepted — implemented
- Date: 2026-08-31
- Amends: [ADR 0021](0021-list-query-search-filter-sort.md) (adopts its three deferred indexes)
- Extends: [ADR 0047](0047-observability-prometheus-grafana.md) (disk usage is read through the
  observability stack it already deployed, not a new metric)
- 한국어: [0049-performance-capacity-criteria.ko.md](0049-performance-capacity-criteria.ko.md)

## Context

[ROADMAP.md](../ROADMAP.md) Stage 4 lists "Performance / capacity criteria" — index policy,
response-time targets, disk ceilings, measured before optimized — as the last undecided row
before the deployment act itself. Two things made this task's timing right rather than
premature: the board domain (Stage 3) is complete, so the query shapes under test are final,
not a moving target; and the observability stack ([ADR 0047](0047-observability-prometheus-grafana.md))
already landed, so `http_request_duration_seconds` and infra-level metrics exist to compare a
future measurement against.

[ADR 0021](0021-list-query-search-filter-sort.md) deferred three `file_entity` indexes with an
explicit trigger — "measure at ~10^4+ rows" — and never committed a response-time target or a
disk-ceiling policy at all. Neither existed anywhere in the repo before this ADR: no load-test
tooling, no documented p50/p95 target, no stated file-storage capacity stance.

## Decision

### D1 — Response-time targets (p50/p95), per endpoint tier

| Tier | Target | Endpoints |
|---|---|---|
| List | p50 < 50ms / p95 < 200ms | `GET /file`, `GET /post`, `GET /comment` (thread) |
| Detail | p50 < 30ms / p95 < 100ms | `GET /file/:id`, `GET /post/:id` |
| Content serving (local disk) | p50 < 100ms / p95 < 300ms | `GET /file/:id/content` under `STORAGE_DRIVER=local` |
| Write | p50 < 100ms / p95 < 300ms | `POST`/`PATCH`/`DELETE` across File/Post/Comment |

These are measured at the DB+app layer against a local/Docker Postgres — not against the live
AWS deployment, which is torn down between verification passes (ROADMAP §9) and was out of
scope for this task's constraints. Chosen as a resource/capacity-cost trade-off, not a UX
guess: at this project's default TypeORM connection pool (10), the list/detail targets imply
roughly 50-100 sustainable req/s per instance before requests start queueing on a held
connection — headroom this project's traffic has never approached, while still being tight
enough to catch a real regression (an N+1 reintroduced, a missing `take`/`skip`).

### D2 — Measurement method and tooling

`autocannon` (MIT, devDependency) drives HTTP-level load; raw `EXPLAIN (ANALYZE, BUFFERS)`
verifies what the query planner actually did. Both run against a disposable `sharenpo_perf`
database — never the dev DB — recreated via the same throwaway-database pattern
`test/e2e-utils.ts` already uses for e2e, built by the real committed migrations (never
`synchronize: true`). `perf/seed.js` seeds 50 users, 10,000 `file_entity` rows, and 10,000
`post_entity` rows — the exact order of magnitude ADR 0021 named as its trigger — plus two
real on-disk files for the content-serving benchmark (list/detail measurement needs no real
bytes; `GET /file/:id/content` does). `perf/explain.js` runs the six representative query
shapes (default sort, `ILIKE` search, `creatorId` filter — for both `file_entity` and
`post_entity`) before and after the D3 indexes. `perf/load-test.js` logs in as the seeded
measurement user and drives autocannon against list/detail/content/write endpoints, reporting
p50 and autocannon's p97.5 (the closest built-in percentile to this ADR's p95 targets) against
the D1 thresholds. `k6` and Artillery were considered and rejected: k6 needs a standalone
binary outside the pnpm toolchain for no capability this project's endpoint shapes need;
Artillery's scenario/staged-load DSL is unused surface for a fixed set of single-request
benchmarks (YAGNI).

### D3 — Adopt all three of ADR 0021's deferred indexes, on both `file_entity` and `post_entity`

ADR 0021 named the indexes and their trigger only for `file_entity`; `post_entity` inherited
the identical read layer (search/sort/`creatorId`) without ever getting its own index
candidates considered. Measured together, 10,000 rows each:

**EXPLAIN (ANALYZE, BUFFERS), before → after (real migration-created indexes):**

| Query | Before | After | Speedup | Index used |
|---|---|---|---|---|
| `file_entity` default sort | 3.43ms (Seq Scan) | 0.298ms (Index Scan Backward) | 11.5x | `IDX_file_entity_createdAt_id` |
| `file_entity` search `ILIKE` | 4.43ms (Seq Scan) | 1.222ms (Bitmap Index Scan) | 3.6x | `IDX_file_entity_title_trgm` |
| `file_entity` `creatorId` filter | 0.63ms (Seq Scan) | 0.204ms (Bitmap Index Scan) | 3.1x | `IDX_file_entity_creatorId` |
| `post_entity` default sort | 2.82ms (Seq Scan) | 0.040ms (Index Only Scan) | 70x | `IDX_post_entity_createdAt_id` |
| `post_entity` search `ILIKE` | 3.96ms (Seq Scan) | 0.917ms (Bitmap Index Scan) | 4.3x | `IDX_post_entity_title_trgm` |
| `post_entity` `creatorId` filter | 0.55ms (Seq Scan) | 0.334ms (Index Scan Backward + filter) | 1.6x | `IDX_post_entity_createdAt_id` (planner prefers the sort index over a bare `creatorId` scan to avoid a separate sort) |

**autocannon (20 connections, 10s), before → after — all pass D1's targets in both states:**

| Endpoint | Before p50/p95 | After p50/p95 | Throughput before → after |
|---|---|---|---|
| `GET /file` (list) | 30/45ms | 23/29ms | 639 → 831 req/s |
| `GET /file?search=holiday` | 41/50ms | 23/28ms | 472 → 837 req/s |
| `GET /file?creatorId=` | 24/34ms | 21/31ms | 801 → 882 req/s |
| `GET /post` (list) | 29/47ms | 22/27ms | 661 → 866 req/s |
| `GET /file/:id` (detail) | 9/12ms | 9/13ms | ~2000 req/s (unaffected, as expected) |
| `GET /file/:id/content` (local, public) | 14/25ms | 14/25ms | unaffected — index-independent path |
| `GET /file/:id/content` (local, private) | 17/28ms | 16/26ms | unaffected |
| `PATCH /file/:id` (write) | 19/32ms | 16/19ms | 960 → 1189 req/s |

Disk cost: 6 new indexes total **~2.16MB** at 10,000 rows combined (`file_entity`+`post_entity`
tables themselves are ~3MB each) — negligible.

**Honest reading of the evidence**: every endpoint already meets D1's targets *without* any of
these indexes at this row count — Node/Nest overhead (validation, serialization, guards)
dominates over the sub-5ms query cost either way, so the end-to-end HTTP win is modest (+20-30%
throughput on list endpoints). The SQL-level win is real and substantial (up to 70x), the cost
is near zero, and Stage 3's board expansion means row counts only grow from here — ADR 0021's
own trigger ("measure at ~10^4+ rows") has now fired with a positive, cheap result, so deferring
further would just be re-litigating a question this ADR already measured. Adopted for both
tables, not `file_entity` alone.

One correction to ADR 0021's own text: it wrote the search candidate as "`pg_trgm` GIN on
`lower(title)`". Measured directly — a `lower(title)` expression index is never selected by the
planner here, because `FileService.getFiles`/`PostService.getPosts` apply `ILIKE` to the raw
`title` column, not to `lower(title)`; the expression must appear in the query for Postgres to
match it to an expression index. The adopted index is on the raw `title` column instead
(`gin_trgm_ops`), which the measured `Bitmap Index Scan` confirms the planner actually uses.

**Migration**: `backend/migrations/1788180660994-AddPerformanceIndexes.ts`, hand-authored (not
`migration:generate` output) for the same reason `AddFileMediaType1786818802632` was —
`migration:generate` cannot express a GIN index with the `gin_trgm_ops` operator class from
entity metadata alone. `file.entity.ts`/`post.entity.ts` declare `@Index` for the two plain
btree candidates (`createdAt`+`id`, `creatorId`); the two trigram indexes exist only in the
migration, with a comment on each entity warning that a future `migration:generate` run will
propose (incorrectly) dropping them — the same class of spurious-statement noise this project's
convention already strips by hand on every `generate` review.

### D4 — File-storage disk ceiling: usage-rate monitoring, not an absolute cap

No absolute byte ceiling is set on `file/upload`. `k8s/helm/values.yaml`'s `resources: {}` already
documents that container/PVC sizing has never been measured for this portfolio-scale project;
setting an absolute disk quota now would be exactly the "no measurement behind it" pattern this
whole task exists to avoid. Instead: disk usage is read via the `node-exporter` component
`kube-prometheus-stack` already installs ([ADR 0047](0047-observability-prometheus-grafana.md) D2)
— `node_filesystem_avail_bytes` / `node_filesystem_size_bytes` at the node/PVC mount — with no
new application code or metric needed. `TEMP_SWEEP_TTL_HOURS` (default 24h, [ADR 0018](0018-orphan-temp-file-cleanup.md))
and the existing pagination caps (`take` 1-100, [ADR 0021](0021-list-query-search-filter-sort.md))
were reviewed and kept unchanged — no measurement in this task argued for adjusting either.

## Consequences

- Schema: 6 new indexes across `file_entity`/`post_entity` (`AddPerformanceIndexes1788180660994`),
  plus the `pg_trgm` extension. No column changes, no data migration. `test/e2e-utils.ts`'s
  `MIGRATIONS` list gained this migration (its `TABLES` list is unaffected — no new table).
- New devDependency: `autocannon` (MIT). New tooling directory `perf/` (`perf-db.js`,
  `seed.js`, `explain.js`, `load-test.js`) — reusable for re-measuring this same baseline after
  a future regression is suspected; never wired into CI (mirrors `.claude/scripts/`'s
  run-by-hand convention, not `.claude/hooks/`'s automatic one).
- This ADR is the performance/capacity baseline ROADMAP Stage 4 asked for: a future regression
  is judged against the D1 targets and the D3 table, not intuition.
- Residual, accepted: measurement ran against local/Docker Postgres only, per this task's own
  constraint — the live AWS deployment is intermittently torn down (ROADMAP §9) and was out of
  scope. `GET /file/:id/content` under `STORAGE_DRIVER=s3` (the presigned-redirect path, ADR
  0036) was not benchmarked — only the `local` streaming path, which is what a local/Docker
  measurement environment can exercise.

# ADR 0021: List Query — Whitelisted Sort, ILIKE Title Search, Creator Filter

- Status: Accepted
- Date: 2026-07-30
- 한국어: [0021-list-query-search-filter-sort.ko.md](0021-list-query-search-filter-sort.ko.md)

## Context

ROADMAP Stage 3 opens with "List search / filter / sort" — the data-layer prerequisite for
board listings, and a read layer the later post/comment modules inherit rather than reinvent.
Before this ADR, `GET /file` accepted only `take`/`skip`:

| Capability | Behavior before this ADR |
|---|---|
| Pagination | `take` 1–100 (default 20), `skip` (default 0) — `GetFilesDto`, added 2026-07-22 |
| Sorting | **None at all — no `ORDER BY` in the query** |
| Title search | None |
| Author filter | None |

The missing `ORDER BY` is not merely a gap. `OFFSET`/`LIMIT` over an unordered query has
**undefined row order in PostgreSQL**, so paging through `GET /file` could already repeat a
row on one page and skip another — a latent correctness bug, not just a usability one.

The query is already `createQueryBuilder`-based with `leftJoinAndSelect('file.creator')`, so
the extension path exists and the N+1 prohibition (Never Do Group 2) is already satisfied.
The constraint that shapes everything below: a sort key arriving from a client is a
*column name*, the one place in this codebase where request text would otherwise be
concatenated into SQL.

## Decision

**`GET /file` gains four optional query parameters — `search`, `sortBy`, `order`,
`creatorId` — declared on `GetFilesDto`, with sorting resolved exclusively through an
in-code whitelist. The response shape is unchanged.**

| Parameter | Values | Default |
|---|---|---|
| `search` | title substring, ≤100 chars | absent |
| `sortBy` | `createdAt` \| `title` \| `id` | `createdAt` |
| `order` | `DESC` \| `ASC` | `DESC` |
| `creatorId` | positive integer | absent |

Mechanics that are part of the decision, not incidental:

- **Sorting is two enum parameters (`sortBy` + `order`), not a compound string.** Validation
  is `@IsIn` alone — no regex, no parsing step, so there is no parser to get wrong. It also
  renders in Swagger as two enumerated dropdowns, matching the existing declarative DTO
  style (`GetFilesDto`, `DeleteUserQueryDto`).
- **A client string never reaches the query as a column name.** `FILE_SORT_FIELDS` is a
  literal tuple in the DTO; `FileService` keys a **total** `Record<FileSortField, string>`
  off it (`SORT_COLUMN`). Adding a key to the tuple without a column mapping is a
  **compile error**, so the whitelist cannot silently drift out of sync with the query — the
  guarantee is structural, not a review habit.
- **The whitelist is narrower than the schema, deliberately.** `filePath` is a sortable
  column and is *not* offered: it exposes storage internals as an ordering axis for no board
  use case. Whitelist membership is a product decision, not "every column that works".
- **Default sort is `createdAt DESC`, with `file.id` appended as a tiebreaker.** The
  tiebreaker is what makes offset pagination deterministic: rows sharing a `createdAt` (or
  an identical `title`) would otherwise be free to reorder between two page requests. It is
  skipped when `sortBy=id`, which is already unique — appending it twice would only
  duplicate the clause.
- **Search is `ILIKE '%term%'` with LIKE metacharacters escaped.** Values are parameter-bound,
  so injection is not the concern; an unescaped `%` or `_` is: it would silently widen the
  match far beyond what the user typed (`_` matches any single character). The term is
  escaped for `\`, `%`, `_` and the query states `ESCAPE '\'`. A whitespace-only term is
  trimmed to nothing and treated as absent, so `?search=` is not an empty-result trap.
- **`creatorId` filters through the join that already exists** — one predicate, no extra
  query, no new relation load.
- **No index, and no schema change.** All three candidate indexes are unmeasured
  speculation at this table's size (Avoid Premature Optimization). Recorded in
  Consequences with the conditions that would justify each.
- **`FileService.getFiles` now takes the DTO object** instead of positional `take, skip`.
  Six positional arguments is an invitation to transpose two of them at the call site; the
  controller already holds the validated DTO whole and forwards it without interpreting it.

## Alternatives rejected

- **Compound sort string (`?sort=createdAt:DESC`)** — one parameter instead of two, and it
  extends to multi-key sorting by comma later. Rejected now: it needs `@Matches` plus a
  manual split in the service, i.e. hand-written parsing where the enum shape needs none,
  and it documents itself worse in Swagger. Revisit if multi-key sorting is actually
  requested — the whitelist map survives that change unchanged.
- **Signed prefix (`?sort=-createdAt`)** — terse and equally injection-free, but the
  whitelist doubles (field × direction) and the `-` convention lives in prose documentation
  rather than in the type.
- **Full-text search (`to_tsvector` + GIN)** — real ranking and stemming. Rejected: it is a
  schema change (a generated `tsvector` column plus an index) for a single-column search over
  a small table, and without a Korean morphological analyzer it would *lose* the partial-word
  matches this domain's titles need (searching `여행` would not find `해외여행`) — worse
  accuracy at higher cost.
- **`pg_trgm` similarity** — typo tolerance, and the only thing that makes `%term%` index-usable.
  Rejected: an extension install plus a migration, before a single measurement says the scan
  is a problem.
- **Prefix-only search (`term%`)** — the one shape a plain b-tree could serve. Rejected as a
  correctness regression: a board search that cannot find a word in the middle of a title
  ("holiday" missing "Summer Holiday Trip") fails the feature's purpose to buy an index this
  table does not need yet.
- **`creatorEmail` filter** — friendlier than a numeric id, but it turns the list endpoint
  into an email-existence oracle (an enumeration surface). `creatorId` carries no such
  signal; a client that has an email already has the id from the response body.
- **Date-range filter (`from`/`to`)** — cheap to add, no requirement behind it (YAGNI). The
  sort whitelist already covers "browse by recency".
- **Keyset (cursor) pagination** — the structurally correct fix for offset drift, and it
  scales past deep `OFFSET`. Rejected here: it changes the frozen response contract
  ([ADR 0010](0010-frontend-split-and-api-surface-freeze.md)) and the client's paging model,
  which is out of scope for a task whose brief was "keep pagination, add query capability".
  The `id` tiebreaker makes the current offset model deterministic, which was the actual
  defect.

## Consequences

- **`GET /file` responses now come back ordered — newest first — where they previously came
  back in whatever order Postgres chose.** This is a visible behavior change for any existing
  caller, and simultaneously the fix for the duplicate/skipped-row hazard described in
  Context. The response *shape* (`[files, totalCount]`) is untouched, and every new parameter
  is optional, so the frozen API surface (ADR 0010) holds: a caller that sends nothing
  behaves as before, only deterministically.
- **No new error codes.** An unknown `sortBy`/`order`, an over-long `search`, or a
  non-integer `creatorId` are all rejected at the boundary by the global pipe as
  400 `VALIDATION_FAILED` ([ADR 0011](0011-error-code-contract.md)). Adding a code is free,
  but there is no outcome here the existing catalog does not already name.
- **Undeclared query parameters remain rejected**, not ignored: `forbidNonWhitelisted` means
  a typo like `?orderBy=title` is a 400 rather than a silently unsorted list. That is the
  deliberate strict-input stance (Robustness Principle explicitly not applied), and it is
  pinned by an e2e case.
- **Deferred indexes**, with the trigger for each — all three are plain-text descriptions
  here, not migrations:
  - `("createdAt" DESC, "id" DESC)` — would let the default sort and page boundary be read
    straight from an index instead of sorting the table per request. Justified when row
    count makes the sort measurable (order of ~10⁴+).
  - `pg_trgm` GIN on `lower(title)` — the *precondition* for `ILIKE '%term%'` to use an
    index at all; a b-tree cannot serve a leading wildcard. Requires the extension, so it
    is a two-part migration.
  - `("creatorId")` — Postgres does not index FK columns automatically. Would serve both the
    new filter and the account-cascade delete ([ADR 0020](0020-account-deletion-cascade.md)).
  Until then, `search` and `creatorId` are sequential scans and the sort is a full sort. At
  this project's scale that is the cheaper trade; the measurement, not the intuition, should
  reverse it.
- **`search` is bounded at 100 characters** so the ILIKE pattern cannot be made arbitrarily
  long by a caller — pattern matching cost is an input-size function, and no legitimate title
  is longer.
- **The read layer is now the pattern for Stage 3's post listing**: DTO-declared parameters,
  a total-`Record` sort whitelist, escaped ILIKE, and a unique tiebreaker on every ordered
  page. A post module should extend this shape rather than restate it.
- **Test coverage**: 9 new `file.service.spec.ts` cases (column mapping, tiebreaker presence
  and its `sortBy=id` suppression, wildcard escaping, whitespace-only term, filter,
  combination) and 10 new e2e cases over real Postgres — including the two rejections that
  prove the whitelist is enforced by the boundary rather than by the query.

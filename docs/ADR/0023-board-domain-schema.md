# ADR 0023: Board Domain Schema — Post and Comment

- Status: Accepted
- Date: 2026-07-30
- 한국어: [0023-board-domain-schema.ko.md](0023-board-domain-schema.ko.md)

## Context

ROADMAP §5 (domain plan) and the Stage 3 "Board domain" row: the *board* in this
project's name is unimplemented. The API today manages video files and nothing else.

This ADR is the **design gate that precedes that implementation**, not the implementation.
[CLAUDE.md](../../CLAUDE.md) > Scope Discipline requires an entity change to be described in
plain text before any migration is generated; this document is that description for both
new entities at once. **No entity, migration, DTO, or service code lands with this ADR.**

Post and comment are designed *together* deliberately. They are not two independent
schemas: the comment→post foreign key, the account-deletion order, and the post→file
reference are the same decision seen from three sides. Designing comment after post would
mean re-deriving post's delete path halfway through the comment task — the schema rollback
this gate exists to prevent.

Constraints found by tracing the current code, all of which bind the design below:

| Fact | Source | Effect on this design |
|---|---|---|
| FKs are declared `ON DELETE NO ACTION` with readable constraint names (`FK_file_entity_creator`) | `backend/migrations/1784678400000-InitialSchema.ts:36-38` | New FKs follow the same naming; a deviation from `NO ACTION` must be argued, not assumed |
| `FileEntity.creator`'s `cascade: true` is TypeORM's *persist* cascade — it propagates saves, not deletes | [ADR 0020](0020-account-deletion-cascade.md) Context | Nothing in the ORM layer deletes children for us; every delete path below is decided explicitly |
| Only the owning side of a relation is ever queried — `file.creator` appears in 6 queries, the inverse `UserEntity.creator` in none | `backend/file/file.service.ts:121,152,182,345,428,486` (verified 2026-07-30) | The inverse property earns nothing; see "Relations are unidirectional" below |
| `canManage(creatorId, requester)` = creator **or** admin+ | `backend/file/file.service.ts:84-89` | Reused verbatim; the board introduces no new authorization shape |
| Account deletion is one `dataSource.transaction()`, with the irreversible `unlink` **after** the commit | [ADR 0020](0020-account-deletion-cascade.md) | Post/comment deletes join that transaction; nothing about the unlink ordering changes |
| A unique-constraint violation (`23505`) is translated into a typed outcome rather than a 500 | [ADR 0019](0019-upload-claim-idempotency.md) | The same technique answers both duplicate submission and the file-in-use delete (`23503`) |
| The list read layer is DTO-declared parameters + a total-`Record` sort whitelist + escaped ILIKE + a unique tiebreaker | [ADR 0021](0021-list-query-search-filter-sort.md) Consequences | The post listing **extends** that layer; it does not restate it |
| Routes stay singular (`/file`, `/user`); the plural rename was considered and rejected | [ADR 0010](0010-frontend-split-and-api-surface-freeze.md) | `/post`, `/comment` |

## Decision

**Two new entities — `post_entity` and `comment_entity` — in two new modules. A post
optionally references exactly one file, which must be one the poster created. Comments are
flat and die with their post through a database cascade. Every other deletion stays
explicit in the service, as [ADR 0020](0020-account-deletion-cascade.md) established.**

### `post_entity`

| Column | Type | Notes |
|---|---|---|
| `id` | `PrimaryGeneratedColumn` | As both existing entities |
| `title` | `varchar`, **not unique** | Length bounded at the DTO (≤100), not by the column |
| `body` | `text`, not null | Bounded at the DTO (≤10,000) |
| `creatorId` | FK → `user_entity`, not null, `NO ACTION` | Property named `creator`, matching `FileEntity.creator` |
| `fileId` | FK → `file_entity`, **nullable**, **UNIQUE**, `NO ACTION` | `@OneToOne` + `@JoinColumn`; see D1 |
| `createdAt` / `updatedAt` | `CreateDateColumn` / `UpdateDateColumn` | Per-entity, no shared base entity (unchanged YAGNI stance) |

`title` is deliberately **not** unique, unlike `FileEntity.title`. A board on which a title
can be used only once, globally, across all authors, is a defect — the existing unique
constraint on file titles is not a pattern to replicate here. The consequence is that a post
has no natural idempotency key from its own text; D1 supplies one instead.

### `comment_entity`

| Column | Type | Notes |
|---|---|---|
| `id` | `PrimaryGeneratedColumn` | |
| `body` | `text`, not null | Bounded at the DTO (≤1,000) |
| `creatorId` | FK → `user_entity`, not null, `NO ACTION` | Property named `creator` |
| `postId` | FK → `post_entity`, not null, **`ON DELETE CASCADE`** | See D3 — the one sanctioned DB-level cascade |
| `createdAt` / `updatedAt` | | |

No `parentId`: comments are flat (D2). No denormalized counters (`commentCount`,
`viewCount`) — no requirement exists for them, and each is an additive column later.

**Relations are unidirectional.** `PostEntity` declares `creator` and `file`;
`CommentEntity` declares `creator` and `post`. Neither `UserEntity` nor `FileEntity` gains
an inverse collection property. This is not a break with the "relations always explicit"
convention — the relation is fully declared, on the side that owns the column. The inverse
side is omitted because it is measurably dead weight: the one inverse that exists today
(`UserEntity.creator`) is used by zero queries (verified above), while adding two more
would mean editing two high-blast-radius `*.entity.ts` files for properties no query reads.

### D1 — post ↔ file is 1:1, optional, and same-creator

`post.fileId` is a **unique, nullable** FK. A post carries at most one video; a video is
attached to at most one post; a post may carry none. **A post may only reference a file its
own creator created** — the check lives in `FileService` (the layer that owns file
ownership), which `PostService` asks; `PostService` never reads `file.creator.id` itself
(Law of Demeter / Tell Don't Ask).

That invariant is load-bearing, not decoration. It is what makes the ADR 0020 account
cascade safe: because a user's posts can only reference that same user's files, deleting
the account's posts before its files leaves no post pointing at a deleted file — the FK
violation is structurally unreachable rather than merely unlikely. Under an N:1 relation, a
stranger's post referencing my file would resurrect the exact `23503` → 500 that ADR 0020
was written to eliminate.

The unique constraint also supplies the idempotency key that `title` cannot
([CLAUDE.md](../../CLAUDE.md) > Maintainability > Idempotence requires new write endpoints to
name one). `POST /post` resolves a repeat submission as:

| Repeat submission of `POST /post` | Outcome |
|---|---|
| Same `fileId`, same creator, **identical** `title` and `body` | **200** — the existing post is returned (a retry) |
| Same `fileId`, same creator, different `title` or `body` | **409 `POST_FILE_TAKEN`**, naming the post that already holds the file |
| Same `fileId`, a different user | **403 `FORBIDDEN_NOT_OWNER`** — the ownership check fires first |
| `fileId` that does not exist | **404 `FILE_NOT_FOUND`** |
| No `fileId` at all | A second post is created — a fileless post has no natural key (documented, accepted) |

A concurrent double-submit is settled by `UQ_post_entity_fileId`: the loser catches `23505`
and re-resolves through the same table. This is [ADR 0019](0019-upload-claim-idempotency.md)'s
mechanism reused, with one deliberate difference — ADR 0019 replays for the claimant
unconditionally, while this endpoint replays only when the payload matches. The reason is
that a file's promotion carries no user-authored content that could differ, whereas a post
does: replaying a *different* title and body would silently return the wrong post to someone
who believed they were writing a new one.

`fileId` is fixed at creation. `PATCH /post/:id` may change `title` and `body` only —
mutating the attachment would open a second claim/replay surface on a route that has no
requirement for one. Detaching a video means deleting the post.

### D2 — comments are flat

No `parentId`, no threading. One data shape means one ordering rule, one pagination rule,
and one delete rule. Adopting replies later is an **additive** migration — a nullable
self-referencing column with no backfill — so deferring costs no rollback, which is the
risk this gate exists to remove. What a later reply feature *would* have to decide (parent-
child interleaving in a paginated list, and what happens to replies when a parent is
deleted) is exactly the design work that is being deferred, not hidden.

### D3 — post deletion cascades to comments through the FK

`comment.postId` carries **`ON DELETE CASCADE`** — the only database-level cascade in this
schema. Everything else stays an explicit service cascade.

The principled line: **a database cascade is used where the child has no independent
existence and no non-DB side effect; a service cascade is used where the parent is an
account, because that path needs confirmation, an audit row, and physical unlinking.** A
comment has no URL, no file, and no meaning outside its post. ADR 0020's "never suggest
`ON DELETE CASCADE`" is scoped to `FileEntity.creator` and exists because that path must
read the stored paths it is about to unlink — a reason that does not transfer here.

The alternative — deleting comment rows in the service — is not merely more verbose, it is
*worse*: during an account cascade, "other people's comments on this user's posts" would
require `CommentService` to issue a subquery over `post_entity` (crossing a module
boundary), or to delete by a list of post ids read moments earlier — the exact
read-then-delete race ADR 0020 forbids. The database cascade has no such window.

Its cost is recorded in Consequences: the cascaded row count is not returned to the
service, so audit details count posts and files but not comments.

### D4 — deleting a file that a post references is refused, via the FK

`DELETE /file/:id` for a file attached to a post raises `23503`, which is translated into
**409 `FILE_IN_USE`**. No pre-check query is issued.

A pre-check was rejected on two independent grounds. It would make `FileService` read
`post_entity`, and since `PostService` already asks `FileService` about file ownership (D1),
that is a **module dependency cycle** requiring `forwardRef` — a pattern with no precedent in
this codebase. And it would leave a window: a post created between the check and the delete
would still hit the constraint, so the 500 would merely become rarer instead of impossible.
Letting the database be the authority is race-free and cycle-free, and it is the same
technique ADR 0019 already applies to `23505`.

`ON DELETE SET NULL` was rejected outright: it makes the delete always succeed by silently
stripping the video out of somebody's published post.

### D5 — the account cascade absorbs posts and comments; the confirmation flag does not change

[ADR 0020](0020-account-deletion-cascade.md)'s `?deleteFiles=true` keeps its exact current
meaning — it confirms the destruction of **file rows and stored bytes**, and 409
`USER_HAS_FILES` still fires only when the account owns *files*. Posts and comments are
deleted unconditionally, in the same transaction, with no confirmation of their own.

The reason the flag was not widened: it guards **irreversible media bytes served at a public
URL**, which is what makes a silent cascade there unacceptable. Widening it to text content
would leave the parameter name (`deleteFiles`) and error code (`USER_HAS_FILES`) describing
something narrower than what they now gate, and a second flag would add a query parameter to
a route whose surface is frozen (ADR 0010). The honest cost — deleting an account destroys
its posts, and every comment anyone wrote on them, with no confirmation step — is recorded
in Consequences rather than papered over.

Order inside the existing `dataSource.transaction()`, all deletes keyed by `creatorId`
(never by an id list read moments earlier — ADR 0020):

1. comments authored by the user, anywhere (their comments on *other* people's posts are
   reachable no other way);
2. the user's posts — the FK cascade removes whatever comments remain on them;
3. only with `deleteFiles=true`: read the stored paths, then delete the file rows;
4. the user row;
5. **after the commit**: unlink the stored files, best-effort, failures logged at `warn`.

### Complete deletion matrix

| Request | post rows | comment rows | file rows | disk |
|---|---|---|---|---|
| `DELETE /comment/:id` | — | the one comment | — | — |
| `DELETE /post/:id` | the one post | its comments (FK cascade) | **kept** | **kept** |
| `DELETE /file/:id`, unattached | — | — | deleted | unlinked (post-commit) |
| `DELETE /file/:id`, attached to a post | — | — | **refused — 409 `FILE_IN_USE`** | untouched |
| `DELETE /user/:id`, account owns files, no flag | — | — | **refused — 409 `USER_HAS_FILES`** | untouched |
| `DELETE /user/:id`, account owns no files | all of the user's | authored + on their posts | — | — |
| `DELETE /user/:id?deleteFiles=true` | all of the user's | authored + on their posts | deleted | unlinked (post-commit) |

A post deletion deliberately leaves its file alone. The file is `FileModule`'s row, it
predates the post (two-phase upload → `POST /file` → `POST /post`), and it remains listed by
`GET /file` and deletable by `DELETE /file/:id`. A post is a *reference* to a file, never its
owner.

### Ownership, RBAC, and guards

- Updating or deleting a post or a comment requires **creator or admin+** — `canManage`
  reused unchanged ([ADR 0013](0013-rbac-and-audit-log.md)), throwing 403
  `FORBIDDEN_NOT_OWNER`.
- **A post's author does not gain moderation power over comments on their post.** That
  third authorization axis would require reaching through `comment.post.creator.id` — the
  reach-through the Structure Analysis checklist forbids — and admin moderation already
  covers the spam case. If it is ever wanted, it needs its own decision.
- Every board route sits behind `JwtAuthGuard`, reads included. Unauthenticated reads are
  not introduced here; the guarded-by-default stance holds.
- Deletes are audited like the existing ones (ADR 0013): new `POST_DELETE` and
  `COMMENT_DELETE` actions, written after the primary commit. `action` is a plain `varchar`,
  so new values cost no schema change. `USER_DELETE`'s detail gains `posts=N` beside the
  existing `files=N`.

### Routes, modules, and transaction patterns

| Route | Notes |
|---|---|
| `GET /post` | Extends the ADR 0021 read layer: `search` (escaped ILIKE on `title`), `creatorId`, `sortBy` ∈ {`createdAt`,`title`,`id`}, `order`, `take`/`skip`, `id` tiebreaker |
| `GET /post/:id` | Loads `creator` and `file` through the join; never N+1 |
| `POST /post` | D1's claim resolution |
| `PATCH /post/:id` | `title`, `body` only |
| `DELETE /post/:id` | D3 |
| `GET /post/:postId/comment` | Paginated, ordered `createdAt ASC` + `id` tiebreaker — a thread reads oldest-first, unlike the newest-first file list |
| `POST /post/:postId/comment` | 404 `POST_NOT_FOUND` if the post is gone |
| `PATCH /comment/:id`, `DELETE /comment/:id` | `body` only; `canManage` |

`search` covers `title` only, as ADR 0021 does; body search inherits that ADR's deferred
full-text/`pg_trgm` trigger rather than opening it here.

Modules: `PostModule` (imports `FileModule`, `AuditLogModule`; exports `PostService`) and
`CommentModule` (imports `PostModule`, `AuditLogModule`; exports `CommentService`).
`UserModule` imports both for the account cascade, beside the `FileModule` edge ADR 0020
added. The resulting graph — `User → {File, Post, Comment}`, `Post → File`,
`Comment → Post` — is acyclic **because** D4 keeps `FileModule` from needing `PostModule`.
Two new modules for a new domain is the case the module policy explicitly sanctions
(ROADMAP §4).

Transaction patterns, chosen from the table in CLAUDE.md > Transaction Boundary:

| Operation | Pattern | Why |
|---|---|---|
| `POST /post`, `PATCH`, `DELETE /post/:id`, all comment writes | Row 1 — plain repository call | One DB write each; the comment cascade is the database's, and the audit row is written after the commit |
| Account cascade | Row 3 — `dataSource.transaction()` | Already established by ADR 0020; posts and comments join the existing boundary |
| — | Row 2 — manual QueryRunner | **Not used anywhere in this domain.** No board operation has a non-DB side effect inside its boundary; that pattern stays exclusive to the file promotion path |

`PostResponseDto` embeds the file's public URL. The `BASE_URL` composition stays in
`FileService` and is reused rather than duplicated — config access remains centralized.

### Indexes

Adopted with the initial migration:

- `IDX_comment_entity_postId_createdAt` on `("postId", "createdAt")` — the comment list for
  one post, in order, is that table's *only* query shape. The same composite reasoning as
  `AuditLogEntity`'s `["action", "createdAt"]`, and its leading column also serves the FK.
- `UQ_post_entity_fileId` — the D1 constraint itself. Postgres indexes it automatically, and
  that index is what D4's `23503` check rides on.

Deferred, with the trigger for each — plain-text descriptions, not migrations, exactly as
ADR 0021 deferred its three:

- `post("createdAt" DESC, "id" DESC)` — the default sort; justified when row count makes
  the sort measurable (order of ~10⁴+).
- `post("creatorId")` and `comment("creatorId")` — Postgres does not index FK columns
  automatically; these serve the `creatorId` filter and the account cascade. Deferred for
  symmetry with ADR 0021's deferred `file("creatorId")`; account deletion is rare enough
  that a sequential scan there is not the thing to optimize first.
- `pg_trgm` GIN on `lower(post.title)` — the precondition for `ILIKE '%term%'` to use an
  index at all. Requires the extension, so it is a two-part migration.

## Alternatives rejected

- **N:1 post → file** — lets one video be reused across posts. Rejected: it destroys the
  only natural idempotency key `POST /post` has, it makes one file deletion affect an
  unbounded number of posts, and — decisively — a stranger's post referencing my file
  reintroduces the FK-violation 500 that ADR 0020 removed.
- **M:N via a `post_file` join table** — multiple attachments per post, the most flexible
  shape. Rejected as unfounded extension: the upload surface is a single `video` field
  (ADR 0005), no requirement asks for multi-attachment, and the join table adds a cleanup
  step to every delete path plus the loss of the unique-key replay.
- **No file reference at all** — the smallest schema, and the only one that fails the
  domain: an *upload board* whose posts cannot show an upload.
- **Unique `post.title`, mirroring `FileEntity.title`** — would hand `POST /post` an
  idempotency key for free. Rejected: a globally unique title across all authors is a
  board defect, not a feature.
- **One-level replies (`parentId`, depth capped at 1)** — the conventional board shape.
  Deferred rather than refused: it forces a parent-child interleaving rule for paginated
  lists and a reply-orphan rule now, in a task with no reply requirement, when the later
  migration is purely additive.
- **Service-level comment cascade** — surface-consistent with ADR 0020. Rejected on
  mechanics: for an account cascade it needs either a cross-module subquery over
  `post_entity` or a read-then-delete id list that reopens the race ADR 0020 closed.
- **A pre-check before `DELETE /file/:id`** — makes the refusal visible in code, but creates
  a `File ↔ Post` module cycle needing `forwardRef`, and still leaves a race window.
- **`post.fileId ON DELETE SET NULL`** — file deletion would always succeed, at the price of
  silently stripping the video from a published post.
- **A confirmation flag for post deletion (`?deleteComments=true`)** — symmetric with
  ADR 0020 in form only. A comment has no independent existence or URL, so the flag would
  protect nothing while making the common path a two-step chore.
- **Widening `deleteFiles=true` to gate all content, or adding a second flag** — the more
  cautious readings of D5. Rejected as described there: the first makes the parameter and
  error-code names inaccurate, the second adds a parameter to a frozen route.
- **Post author moderating comments on their post** — a real board convention, rejected here
  because implementing it requires the `comment.post.creator` reach-through the project
  bans, for a case admin moderation already covers.
- **Unconditional replay on repeat `POST /post`, exactly as ADR 0019 does** — simpler and
  precedent-following. Rejected because a post carries author-written content that a file
  promotion does not: an unconditional replay would answer a genuinely different submission
  with somebody's earlier post.

## Consequences

- **This ADR changes no code.** The follow-up implementation task generates the migration
  (two tables, four FKs, one unique constraint, one index) and needs approval to touch
  `*.entity.ts`; `migration:generate` output is reviewed line by line, and the baseline's
  readable constraint names mean spurious rename statements must be stripped
  ([ADR 0006](0006-schema-policy-and-migration-adoption.md)).
- **Three new error codes** — `POST_NOT_FOUND`, `COMMENT_NOT_FOUND` (404) and `FILE_IN_USE`
  (409) — plus `POST_FILE_TAKEN` (409) for D1's mismatched-payload branch. Adding codes is
  not a breaking change ([ADR 0011](0011-error-code-contract.md)).
- **A code that looked necessary and is provably unreachable was dropped during this
  design**: "the file is already attached to *another user's* post" cannot occur, because the
  same-creator check (D1) rejects that request with 403 before any uniqueness question is
  asked. CLAUDE.md forbids unreachable guards, so no such branch is specified.
- **Deleting an account destroys its posts and every comment written on them, without a
  confirmation step** (D5). The 409 confirmation still guards only files. A client that
  wants to warn about post loss must do so on its own initiative.
- **The audit trail counts posts but not comments.** Cascaded rows are removed by the
  database and never counted by the service — the accepted price of D3.
- **`ON DELETE CASCADE` now exists in this schema, on exactly one FK.** ADR 0020's
  prohibition is unchanged and still binds `FileEntity.creator`; the line between the two is
  stated in D3 and must be cited whenever a future FK asks for a cascade.
- **`FileModule` gains one consumer and one obligation**: `PostService` asks it whether a
  file is attachable by a given user, and `DELETE /file/:id` must translate `23503` instead
  of letting it become a 500 — the same class of bug ADR 0020 fixed for `DELETE /user/:id`.
- **The post listing inherits ADR 0021 rather than reimplementing it**, including the
  deterministic tiebreaker. A post list without an `ORDER BY` would repeat the offset defect
  that ADR documented.
- **Deferred by design, each needing its own decision**: threaded replies, body search,
  denormalized counters, post-author comment moderation, and unauthenticated public reads.
- **Cross-checked against the existing decisions** — ADR 0013 (ownership shape, audit
  actions, guarded by default), ADR 0019 (`23505` as a typed outcome), ADR 0020 (hard
  delete, no soft delete, explicit service cascade, post-commit unlink, delete by
  `creatorId`), ADR 0021 (read-layer reuse) — with no contradiction found. The one apparent
  conflict, D3's database cascade, is scoped and argued rather than assumed.

## Implementation notes (post module, 2026-07-31)

The decision above is unchanged. These notes record how it landed and what it left open;
they add no new decision.

**Split into two tasks.** The design covers post *and* comment, but the implementation runs
as post first, comment second — comment depends on post, not the reverse. So the migration
landed in two parts rather than the one this ADR's Consequences describe: this task created
`post_entity` (2 FKs, `UQ_post_entity_fileId`), and `comment_entity` plus
`IDX_comment_entity_postId_createdAt` belong to the comment task. Nothing else about the
schema changed. The three error codes this task needs (`POST_NOT_FOUND`, `POST_FILE_TAKEN`,
`FILE_IN_USE`) exist; `COMMENT_NOT_FOUND` was deliberately **not** added ahead of its
consumer, since an unreachable code is dead surface.

`migration:generate` behaved exactly as [ADR 0006](0006-schema-policy-and-migration-adoption.md)
predicted: alongside the four intended statements it emitted four spurious ones, dropping and
re-adding `FK_file_entity_creator` and `IDX_audit_log_entity_action_createdAt` purely to
rename them from the baseline's readable names to TypeORM hashes. Those were stripped; the new
constraints carry readable names (`PK_post_entity`, `UQ_post_entity_fileId`,
`FK_post_entity_creator`, `FK_post_entity_file`).

**Two shapes the design implied but did not name.**

- `FileService.toResponse` went from private to public. D1 says the `BASE_URL` composition
  stays in `FileService` and is reused; making the mapper public is how `PostService`
  reuses it instead of recomposing the URL. `PostService` never touches `file.creator`.
- `FileService.assertAttachableBy(fileId, requesterId)` is the "asks `FileService`" of D1,
  as a judgment rather than a getter. It is **identity-only, deliberately not `canManage`** —
  an admin attaching another user's file would break the very invariant that makes the
  account cascade FK-safe, so RBAC does not widen this check.

**One reachable case the design treats as structurally impossible.** D1 argues the
same-creator rule makes a post-referencing-a-stranger's-file unreachable. It is unreachable
at *creation*, but `PATCH /file/:id { userId }` reassigns file ownership afterwards, which
can produce exactly that state. Two consequences follow, and this task deliberately changed
neither, since resolving them is a decision, not an implementation detail:

1. `resolveAttachment` carries an author-identity check before replaying. Without it, the
   file's new owner could be handed the previous owner's post as a "retry". This guard is
   *reachable* precisely because of reassignment, so it is not an unreachable guard.
2. `DELETE /user/:id?deleteFiles=true` can still raise `23503` inside its transaction — if
   the account's files were reassigned *from* another user whose post still references
   one — surfacing as the opaque 500 ADR 0020 set out to remove. Narrow (it needs a prior
   reassignment) but real, and **open**: it is tracked in ROADMAP > Unscheduled rather than
   fixed here, because every candidate fix is a decision — refusing reassignment of an
   attached file, widening the cascade to posts that merely *reference* the account's files,
   or translating the `23503` into a typed refusal. **Decide it before the comment task**:
   the second candidate changes the account-cascade delete order, which the comment task
   extends, so deciding afterwards means rewriting that order twice.

**Verified**: `pnpm lint` clean, 121 unit tests, 52 e2e tests (14 new, covering post CRUD,
the 403 ownership refusals, replay/409 on a repeated `fileId`, 409 `FILE_IN_USE`, and the
account cascade's `posts=N` audit detail).

## Implementation notes (comment module, 2026-07-31)

The decision above is unchanged. These notes record how the second half landed; they add no
new decision. The gate this task waited on — the post↔file invariant gap recorded in the post
notes — was settled first by [ADR 0024](0024-account-cascade-fk-refusal.md), which left the
account-cascade delete order untouched, so the order below is an insertion rather than a
rewrite.

`comment_entity` landed exactly as designed: `body` (`text`, bounded at the DTO ≤1,000), a
`creatorId` FK (`NO ACTION`), a `postId` FK (**`ON DELETE CASCADE`** — still the schema's only
one), and `IDX_comment_entity_postId_createdAt`. `migration:generate` again behaved as
[ADR 0006](0006-schema-policy-and-migration-adoption.md) predicts — six spurious statements
this time, dropping and re-adding `FK_file_entity_creator`, `FK_post_entity_creator`,
`FK_post_entity_file` and `IDX_audit_log_entity_action_createdAt` purely to rename them to
TypeORM hashes. Those were stripped and the new constraints given readable names
(`PK_comment_entity`, `FK_comment_entity_creator`, `FK_comment_entity_post`).

`COMMENT_NOT_FOUND` was added now, with its consumer, as the post notes said it would be.
`COMMENT_DELETE` joined `AUDIT_ACTIONS`.

**Three shapes the design implied but did not name.**

- **Two controllers, not one.** ADR 0023's route table spans two prefixes — a thread hangs off
  its post (`GET`/`POST /post/:postId/comment`), while an existing comment is addressed by its
  own id (`PATCH`/`DELETE /comment/:id`) — and one `@Controller` cannot carry both. Hence
  `PostCommentController` and `CommentController`, both in `CommentModule`. Only the four
  routes the ADR lists exist; a `GET /comment/:id` was written during implementation and
  removed, since an endpoint no decision asked for is scope creep.
- **`PostService.assertPostExists(postId)`** is comment's equivalent of D1's
  "asks `FileService`": a judgment, not a getter, so `CommentService` never queries
  `post_entity` itself. It checks existence without joins rather than reusing `getPostById`,
  which would load the creator and file relations to build a response nobody reads.
- **The comment listing does not join its post.** `postId` is already known from the route, so
  joining would repeat one post's row across every comment in the thread. `toResponse` takes
  the id as a parameter instead, and `CommentResponseDto` carries `postId` rather than an
  embedded post.

**Two things the design decided that the implementation deliberately did not soften.**

1. **No `comments=N` in the `USER_DELETE` audit detail.** The service *can* count the comments
   it deletes explicitly, but not the ones the FK cascade removes, and a partial count reads as
   a total. Consequences already accepted that the audit counts posts but not comments; adding
   the countable half would have contradicted it while looking like an improvement.
2. **A comment has no idempotency key.** Nothing on the row is unique, so a repeated
   `POST /post/:postId/comment` creates a second comment — the same outcome D1 documents for a
   post with no `fileId`, and pinned by a test in both suites so it stays a decision rather
   than an oversight.

**Verified**: `pnpm lint` clean (0 errors, 0 warnings), 141 unit tests (16 new for
`CommentService`, plus `assertPostExists` and the cascade-order assertion), 64 e2e tests
(11 new — thread CRUD, oldest-first pagination, 404 on a missing post for both reads and
writes, the 403 ownership refusals *including* the post author having no power over comments
on their post, `COMMENT_DELETE` auditing, the FK cascade from a deleted post, and the account
cascade taking the account's comments off other people's posts). `/doc` renders all four
routes under `Comment API` behind `@ApiBearerAuth`.

# ADR 0024: Account cascade — a typed refusal instead of an FK-violation 500

- Status: Accepted
- Date: 2026-07-31
- 한국어: [0024-account-cascade-fk-refusal.ko.md](0024-account-cascade-fk-refusal.ko.md)

## Context

[ADR 0023](0023-board-domain-schema.md) D1 states that a post may only reference a file its
own creator created, and leans on that invariant to argue the ADR 0020 account cascade is
FK-safe: delete the account's posts first, and no surviving post can point at a file the
cascade is about to remove.

The post module's implementation notes (2026-07-31) recorded that the invariant does not
actually hold after creation. This ADR settles what to do about it. It is the gate the
ROADMAP places before the comment module, because one candidate fix would have changed the
account-cascade delete order that the comment task extends.

**How the invariant breaks — four steps:**

1. A uploads file F → `F.creator = A`.
2. A creates post P attached to F. `FileService.assertAttachableBy` passes. The invariant
   holds: `P.creator = F.creator = A`.
3. `PATCH /file/:id { userId: B }` → `F.creator = B`
   (`backend/file/file.service.ts` — the `userId` branch of `updateFile`). The invariant is
   now broken: `P.creator = A`, `F.creator = B`.
4. `DELETE /user/B?deleteFiles=true` → `deletePostsOfCreator(B)` removes B's posts, but P is
   A's post and survives → `deleteFilesOfCreator(B)` tries to delete F → `FK_post_entity_file`
   is `ON DELETE NO ACTION` → **`23503`**, uncaught, surfacing as the opaque 500 ADR 0020 was
   written to eliminate.

Three independent facts explain why step 3 does not check for referencing posts, and all
three bind any fix:

| Fact | Source | Effect |
|---|---|---|
| The reassignment branch predates the board domain entirely — it existed before ADR 0011 (2026-07-23), while `post_entity` landed 2026-07-31 | `git log -L` on `backend/file/file.service.ts` | Nothing referenced files when it was written; this is a stale assumption, not a missing line |
| `FileService` cannot query `post_entity` — `PostService` already asks `FileService` about ownership, so the reverse edge is a module cycle needing `forwardRef` | [ADR 0023](0023-board-domain-schema.md) D4 | A service-level pre-check is closed off by the same argument that closed it for `DELETE /file/:id` |
| No constraint ties `post.creatorId` to `file.creatorId`; the FK constrains `post.fileId` only | `backend/migrations/1785428640007-AddPostEntity.ts` | The database does not refuse the reassignment either |
| `assertAttachableBy` is called only from `PostService.create` | `backend/post/post.service.ts` | The invariant is enforced at creation and never revalidated |

The break has exactly one unhandled consequence. Everything else the reassignment can reach
is already typed: `DELETE /file/:id` on the reassigned file answers 409 `FILE_IN_USE`
(D4), deleting the *referencing* post is always FK-legal, and `PostService.resolveAttachment`
already carries an author-identity check so the file's new owner is never handed the previous
owner's post as a replay. Only step 4's `23503` escapes as a 500.

## Decision

**Translate that `23503` into a typed 409 `USER_FILES_IN_USE`, in
`FileService.deleteFilesOfCreator`. The invariant is not restored, the reassignment endpoint
is not narrowed, and the cascade is not widened.**

The account cascade becomes:

| `DELETE /user/:id?deleteFiles=true` | Outcome |
|---|---|
| No other user's post references the account's files | Unchanged — posts, files, user row, then the post-commit unlink |
| Some other user's post references one of the account's files | **409 `USER_FILES_IN_USE`**, whole transaction rolled back, nothing deleted |

The translation lives in `FileService` because file rows stay `FileModule`'s responsibility
even inside `UserService`'s transaction ([ADR 0020](0020-account-deletion-cascade.md)), and
because its sibling `deleteFile` already performs exactly this `23503` → 409 translation. Both
delete paths for file rows now answer a reference the same way, in the same class.

No pre-check query is issued, for the two reasons D4 already established: it would create the
`File → Post` module cycle, and a post created between the check and the delete would still
hit the constraint. The database stays the authority — [ADR 0019](0019-upload-claim-idempotency.md)'s
technique for `23505`, reused a third time.

The refusal message does not name the offending posts. Naming them needs a query over
`post_entity`, which is unavailable for both reasons above, and a diagnostic query after the
failure is impossible anyway: Postgres aborts the transaction at the failing statement. The
message is actionable without it — at the moment of failure the account's *own* posts are
already deleted (step 1 of the order), so any remaining referencing post provably belongs to
another user.

A new code rather than reusing `FILE_IN_USE`: the two answer different questions on different
routes ("this file you named" vs "some file this account owns"), and a client on
`DELETE /user/:id` that received `FILE_IN_USE` could not tell which file it meant. Adding a
code is not a breaking change ([ADR 0011](0011-error-code-contract.md)); the name is
deliberately symmetric with `USER_HAS_FILES`, the other 409 on the same route.

**The delete order inside `UserService.remove` is unchanged**, which is what releases the
comment-module gate: comments can be inserted ahead of posts without this decision being
revisited.

## Alternatives rejected

- **Refuse the reassignment itself, enforced by a composite FK** — add `UNIQUE (id, creatorId)`
  to `file_entity` and make `post_entity` reference `(fileId, creatorId)`, so Postgres refuses
  step 3 outright. This is the only candidate that makes D1's invariant *true* rather than
  merely handled, and it does so without the module cycle, because the database does the
  judging. Rejected on cost against benefit: it is a schema change on two high-blast-radius
  entities plus a migration that must add a redundant unique key to `file_entity` purely to be
  a composite FK target, it makes `post.creatorId` non-updatable in tandem with the file's, and
  it permanently removes an existing capability (an admin transferring ownership of a file that
  happens to be in a post) to close a path whose only unhandled symptom is one error code.
  Recorded rather than discarded: if the invariant is ever needed as a *guarantee* — for
  example if a future feature reads `post.file` to decide authorization — this is the shape to
  adopt, and it supersedes this ADR rather than extending it.
- **Widen the cascade to posts that merely reference the account's files** — delete other
  users' posts when they reference a file of the account being deleted. Rejected on two
  grounds. It destroys third-party content with no confirmation: ADR 0023 D5 already accepts
  that deleting an account takes comments other people wrote *on that account's posts*, but
  taking whole posts other people authored is a materially larger claim, and the confirmation
  flag (`deleteFiles`) names files, not other people's writing. And it is the candidate the
  ROADMAP gate was raised for — it changes the delete order the comment module is about to
  extend, so choosing it would mean rewriting that order twice.
- **Restore the invariant in `FileService.updateFile` with a pre-check** — the direct reading
  of "refuse reassignment". Rejected as unimplementable within the current module graph: it
  needs `FileService` to read `post_entity` (the cycle), and it would still race a post created
  between check and update.
- **Leave it as a 500 and document it** — the null option, and the status quo since
  2026-07-31. Rejected: a foreseeable client-reachable failure surfacing as an opaque 500 is
  the exact defect ADR 0020 and ADR 0019 were written to remove, and CLAUDE.md requires new
  write paths to keep every foreseeable outcome typed.

## Consequences

- **One new error code**, `USER_FILES_IN_USE` (409). Purely additive
  ([ADR 0011](0011-error-code-contract.md)).
- **An account can now be undeletable through no fault of its owner** — if someone else's post
  references one of its files, deletion is refused until that post is removed. This is
  recoverable, not a dead end: `canManage` lets any admin delete the blocking post, and the
  refusal is a 409 with an actionable message rather than a 500. It is also narrow — it
  requires a prior ownership reassignment to occur at all.
- **The post↔file same-creator rule is now a creation-time rule, not an invariant.** ADR 0023
  D1's wording ("the FK violation is structurally unreachable") is superseded on that point:
  the violation is reachable and is now *handled*. Anything that wants to rely on the property
  as a guarantee must adopt the composite FK above first.
- **`resolveAttachment`'s author-identity check stays and stays reachable.** It is the other
  consequence of the same break, already correct, and it must not be simplified away as an
  unreachable guard.
- **The `PATCH /file/:id { userId }` surface is unchanged** — no new refusal, no new
  validation. The endpoint keeps behaving exactly as ADR 0007 described it.
- **The comment-module gate is released**: `UserService.remove`'s delete order is untouched by
  this decision, so comments may join it ahead of posts as ADR 0023 D5 specifies.
- **No schema change, no migration.** The fix is one `try`/`catch` in a method that already had
  the SQLSTATE helper available.

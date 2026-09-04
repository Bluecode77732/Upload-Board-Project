# ADR 0050: Consent-Based File Ownership Transfer

- Status: Accepted
- Date: 2026-09-04
- Amends: [ADR 0024](0024-account-cascade-fk-refusal.md) (resolves the open question its
  Consequences left tracked — the `23503` → 409 `USER_FILES_IN_USE` translation stays
  necessary and unchanged; see Consequences below for why this is an amendment, not a
  supersession)
- 한국어: [0050-consent-based-file-ownership-transfer.ko.md](0050-consent-based-file-ownership-transfer.ko.md)

## Context

`UpdateFileDto.userId` has existed since this project's first commit
(`434c2bcec0a4c6571615128fc2eda687037ff8b3`) — original CRUD scaffolding, not a feature added
for a stated reason. [ADR 0007](0007-ownership-checks-without-rbac.md) is the only ADR that
mentions it, and only to say its guard is creator-only. [ADR 0024](0024-account-cascade-fk-refusal.md)
traced the field to a real consequence — reassigning a file whose creator differs from a post
that references it breaks the post↔file same-creator invariant `ADR 0023` D1 relied on — and
explicitly left "should this field exist at all" open, flagging that removing it would make
its own `23503`-translation branch an unreachable guard.

Investigation for this ADR (2026-09-04) found two things not previously recorded:

- **No live client sends this field.** A grep across `frontend/` and `admin/` found zero call
  sites that include `userId` in a `PATCH /file/:id` body — `frontend/src/api/types.ts`'s own
  comment confirms this app's UI "does not use \[it\] yet." The only way to trigger a
  reassignment today is a direct API call (Swagger's "Try it out", curl).
- **The field has no consent mechanism.** The creator (or an admin) can force a file onto any
  account with zero involvement from the recipient — `file.service.ts`'s `updateFile` only
  checks that the target user exists, nothing else.

The developer supplied the field's actual intended purpose, articulated here for the first
time: let a user who is about to delete or leave their account hand off files they own to
another account, instead of losing them to the deletion cascade
([ADR 0020](0020-account-deletion-cascade.md)) or being forced to keep the account alive to
keep the files.

## Decision

### D1 — Replace immediate reassignment with propose → accept/reject/cancel

`UpdateFileDto.userId` (immediate, unconsented reassignment) is removed. In its place: the
creator (or an admin) *proposes* a transfer to a specific target user; only that target user
can *accept* (moving ownership) or *reject* (declining, no ownership change); the proposer can
*cancel* at any point before the target responds. No party — including an admin — can force a
transfer through without the target's acceptance.

### D2 — Schema: one nullable column, one pending target per file

`FileEntity` gains `pendingTransferToUserId` (nullable FK to `UserEntity`). A single nullable
column, not a separate request table: this project has no stated need for a file to be
proposed to multiple candidates at once, and a plain column keeps "is a transfer pending" a
cheap null-check rather than a join. The direct consequence is structural, not a policy
choice layered on top: **a file can have at most one pending transfer target at a time.**

### D3 — Duplicate proposals are refused, not overwritten

Proposing a transfer while one is already pending answers 409, naming the existing pending
target — it does not silently retarget the pending transfer to the new candidate. The
proposer must explicitly cancel the existing proposal before creating a new one. Chosen over
auto-overwrite so a change in who the file goes to is always a deliberate, visible step (a
`cancel` call the proposer chose to make), never a side effect of proposing to someone else.

### D4 — Admin proposes through the same consent gate; no forced-transfer bypass

An admin may *propose* a transfer (matching the existing creator-or-admin write pattern this
project uses throughout — [ADR 0007](0007-ownership-checks-without-rbac.md)), but acceptance
is always the target user's decision alone. There is no separate admin path that completes a
transfer without the target's consent. This is a deliberate narrowing from the field's old
behavior, where an admin could force a reassignment outright — Consequences below records
what that removes.

### D5 — `DELETE /user/:id?deleteFiles=true` overrides a pending transfer

If an account is deleted with `deleteFiles=true` while one of its files has an unresolved
pending transfer, deletion proceeds exactly as it does today — the file (and its pending
transfer state) is deleted along with everything else the cascade already removes
([ADR 0020](0020-account-deletion-cascade.md)). The cascade gains no new branch, no new wait
state, and no partial-completion mode. A user who wants a pending transfer to survive must
get it accepted (or leave `deleteFiles` unset, which already 409s `USER_HAS_FILES` while the
account still owns the file) before deleting their account — the same "finish the handoff
first" discipline D1 exists to enable, not a new one this decision invents.

### D6 — No new notification infrastructure; audit log records acceptance only

The target learns about a pending proposal, and the proposer learns about a resolution, the
same way this app already surfaces state: by looking at their own file list. No email or
push-notification system is introduced — this project has no external API integrations at
all (CLAUDE.md > Engineering Principles > Reliability > Retry Limits/Timeout), and building
one is far outside this decision's scope.

A new audit action, `FILE_TRANSFER`, is added to `AUDIT_ACTIONS` (`targetType: 'file'`,
[ADR 0045](0045-audit-log-target-type.md)'s discriminator), logged **only at the moment
ownership actually changes** (acceptance) — matching the existing convention that this log
records state changes, not proposals or intent
([ADR 0013](0013-rbac-and-audit-log.md)/[0045](0045-audit-log-target-type.md)). This is the
only place a file's prior owner is still knowable once the previous owner's account is later
deleted — after that, `FileEntity.creator` shows only the current owner, with no history
column of its own.

## Consequences

- **[ADR 0024](0024-account-cascade-fk-refusal.md)'s `23503` → 409 `USER_FILES_IN_USE`
  translation remains necessary and unchanged.** Gating reassignment behind consent does not
  restore the post↔file same-creator invariant — once B accepts, `FileEntity.creator` moves
  to B exactly as the old unconsented field moved it, and a post created by A that still
  references the file diverges from its new owner exactly as ADR 0024 described. This decision
  changes *who can trigger* the reassignment and *what they must obtain first* (the target's
  consent); it does not change that the reassignment, once it happens, has the same downstream
  shape ADR 0024 already handles. This is why this ADR **amends** ADR 0024 rather than
  superseding it — superseding would only have been correct for the "drop the field entirely"
  alternative (rejected below), which really would have made ADR 0024's branch unreachable.
- **New error codes**: a 409 for a duplicate proposal (D3), a typed outcome for
  accept/reject/cancel with nothing pending, and a 403 for anyone other than the pending
  target attempting to accept or reject. Purely additive ([ADR 0011](0011-error-code-contract.md)).
- **Migration**: `FileEntity` gains `pendingTransferToUserId` (nullable FK to `UserEntity`) —
  reviewed line by line before `migration:run`, per Scope Discipline.
- **`UpdateFileDto.userId` is removed.** A client still sending it gets 400
  `VALIDATION_FAILED` from the global pipe's `forbidNonWhitelisted`, not a silent no-op.
- **An admin loses the ability to force a file transfer without the recipient's consent.**
  The old field let an admin reassign any file to any account outright; this decision closes
  that path. No moderation use case for it was ever stated (this project has no moderation
  feature at all — `docs/ROADMAP.md`'s Stage 5 settled "no" on moderation actions), so nothing
  currently depends on the removed capability.
- **Frontend/admin UI is out of scope for this ADR's implementation.** The propose/accept/
  reject/cancel actions and their status badges are `frontend/`/`admin/`-scoped work, tracked
  as a separate follow-up under those directories' own `CLAUDE.md` — this ADR's implementation
  covers the backend only.
- **New endpoint shape decided at implementation time**, following this codebase's existing
  REST conventions rather than fixed here — this ADR settles the state machine and its rules,
  not route naming.

## Alternatives rejected

- **Keep the field, document rationale only** — rejected: does not fix the actual problem this
  ADR was raised to solve (no consent, forced transfers), so it is unresponsive to the
  developer's stated purpose.
- **Drop the field entirely** — rejected: removes a real, now-articulated use case (handing off
  files before account deletion) that has no other path in this API. Recorded for completeness:
  this is the one alternative that really would have superseded ADR 0024 rather than amending
  it, since it removes the only route to the reassignment ADR 0024's `23503` branch exists for.
- **Real-time notification (email/push) on proposal or acceptance** — rejected: no notification
  infrastructure exists anywhere in this project; building one is new scope far beyond this
  decision. The existing file-list display and the existing "typed refusal on a blocked action"
  pattern (`USER_HAS_FILES`-style) already carry enough information without it.
- **Auto-overwrite a pending proposal with a new one** — rejected in favor of an explicit
  cancel-then-repropose, so a change in transfer target is always a deliberate step the
  proposer visibly took, never a side effect of proposing to someone else (D3).
- **Allow multiple simultaneous pending targets, first-to-accept wins** — rejected: needs a
  separate request table, not a nullable column, for no stated need (YAGNI). D2's single-column
  shape is deliberately simpler.
- **Block `DELETE ?deleteFiles=true` while a transfer is pending, to protect the recipient's
  window to accept** — rejected: would make an already-typed, immediate-completion endpoint
  either wait on a third party's decision or gain a new partial-completion mode, for a
  protection nothing else in this ADR's account-deletion use case actually needs (D5).

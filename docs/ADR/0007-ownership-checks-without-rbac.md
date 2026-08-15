# ADR 0007: Ownership Checks Without RBAC

- Status: Accepted
- Date: 2026-07-22
- 한국어: [0007-ownership-checks-without-rbac.ko.md](0007-ownership-checks-without-rbac.ko.md)

## Context

Until this decision, every authenticated user could modify or delete *any* user
account and *any* file — `JwtAuthGuard` proved identity but nothing checked ownership.
The full fix (RBAC: role column + role-aware guard) requires a schema change, which is
blocked on migration adoption ([ADR 0006](0006-schema-policy-and-migration-adoption.md)).

## Decision

Introduce ownership checks now, without roles, as schema-free guards at the
handler/service level; RBAC remains a separate, decided roadmap item.

- **Self-only user writes**: `PATCH /user/:id` and `DELETE /user/:id` compare
  `@UserId()` (JWT identity from `request.user.id`) against the path id and throw
  `ForbiddenException` on mismatch (`backend/user/user.controller.ts`).
- **Creator-only file writes**: `FileService.updateFile`/`deleteFile` load the
  `creator` relation and reject requesters who are not the file's creator
  (`backend/file/file.service.ts`). Ownership *reassignment* via `UpdateFileDto.userId`
  is likewise creator-only.
- Identity always comes from the validated JWT — never from the request payload
  (`@UserId` decorator is the sanctioned accessor).

## Consequences

- The impersonation window (any user editing any resource) is closed without touching
  the schema.
- There are still no admin capabilities — nobody can moderate another user's content.
  That is the RBAC roadmap item, to be layered *on top of* these checks, not instead
  of them.
- File ownership checks live in the service (the transaction already loads the row);
  user self-checks live in the controller (no extra query needed). A future RBAC guard
  should unify placement.

# ADR 0011: Machine-Readable Error-Code Contract

- Status: Accepted
- Date: 2026-07-23
- 한국어: [0011-error-code-contract.ko.md](0011-error-code-contract.ko.md)

## Context

The API surface is frozen ([ADR 0010](0010-frontend-split-and-api-surface-freeze.md))
and a browser frontend is imminent. Until now error responses were Nest defaults —
a status code plus free-text `message`. A frontend built against that has only two
bad options: hardcode message strings (which are prose, not contract) or branch on
status alone (which cannot distinguish "title taken" from "invalid file path", both
400). The error contract must be settled before the first consumer exists, for the
same reason the routes were.

## Decision

- **Frozen wire shape** — every error response is an `ErrorBody`
  (`backend/common/error-code.ts`):

  ```json
  {
    "statusCode": 400,
    "code": "FILE_TITLE_TAKEN",
    "message": "Title already in use.",
    "timestamp": "2026-07-23T09:00:00.000Z",
    "path": "/file/1"
  }
  ```

  `code` is the contract: stable, machine-readable, the only field a client may
  branch on. `message` is human-readable and free to change. `stack` is appended
  only when `ENV=dev`. `timestamp` and `path` are included because no logging
  infrastructure exists yet (ROADMAP Stage 1) — until it lands, the response
  body is the only place an error occurrence can be located after the fact;
  neither field exposes internal structure.
- **String-enum catalog** — `ErrorCode` currently defines 18 codes:
  domain codes (`AUTH_BAD_TOKEN_FORMAT`, `AUTH_INVALID_CREDENTIALS`,
  `AUTH_EMAIL_TAKEN`, `AUTH_TOKEN_INVALID`, `AUTH_UNAUTHORIZED`,
  `FORBIDDEN_NOT_OWNER`, `USER_NOT_FOUND`, `FILE_NOT_FOUND`, `FILE_TITLE_TAKEN`,
  `FILE_INVALID_PATH`, `UPLOAD_FILE_REQUIRED`, `UPLOAD_INVALID_TYPE`,
  `VALIDATION_FAILED`) and status fallbacks (`BAD_REQUEST`, `FORBIDDEN`,
  `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`).
- **Attachment at the throw site, no new exception classes** — codes ride on the
  standard Nest exceptions:

  ```typescript
  throw new BadRequestException({ code: ErrorCode.FILE_TITLE_TAKEN, message: 'Title already in use.' });
  ```

  A custom exception hierarchy was rejected — `HttpException` already preserves
  object bodies, and the repo's conventions forbid new abstractions where a
  framework idiom suffices.
- **One global filter** — `AllExceptionsFilter`
  (`backend/common/filter/all-exceptions.filter.ts`), registered via `APP_FILTER` in
  `app.module.ts` so it stays DI-managed (ConfigService drives the dev-only
  stack). It extracts `code` from the exception body and falls back by status for
  exceptions thrown without one (framework 404s, passport 401s, Multer 413s).
  A 400 whose `message` is an array is labeled `VALIDATION_FAILED` — the global
  ValidationPipe's signature — without touching the pipe.
- **Compatibility rule** — renaming or removing a code is a breaking change
  (needs the versioning decision ROADMAP defers); adding a code is free.
  Non-`HttpException` errors stay `"Internal server error"` outward — internals
  never leak (Never Do Group 3).

## Alternatives rejected

- **Custom exception class hierarchy** (`AppException extends HttpException`) —
  a new abstraction and an inheritance tree for what an object literal already
  expresses; every throw site would need migrating to a bespoke API.
- **Message-string → code mapping inside the filter** — couples the contract to
  prose; every message rewording silently breaks client branching.
- **Numeric code ranges** (e.g. `40001`) — needs a lookup table to be readable;
  string codes are self-documenting in logs and network tabs.
- **Minimal shape** (`statusCode`/`code`/`message` only) — rejected while no
  logging infrastructure exists: dropping `timestamp`/`path` would leave a
  reported error impossible to locate after the fact. Revisit once Stage 1
  logging lands if the fields prove redundant.

## Consequences

- New throw sites must attach `{ code, message }` — the status fallbacks exist
  for framework-originated throws, not as license to omit codes (CLAUDE.md
  convention).
- `all-exceptions.filter.spec.ts` pins the contract (code passthrough, fallbacks,
  validation arrays, dev-only stack); `filter.ts` is coverage-measured.
- README documents the shape for API consumers; Swagger continues to document
  per-endpoint status codes.
- The Stage F pipeline advances: next is the refresh-token httpOnly-cookie move
  + rotation (ROADMAP Stage F task 3).

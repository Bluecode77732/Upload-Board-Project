# Architecture Decision Records

> 한국어 버전: [README.ko.md](README.ko.md)

Records of architecturally significant decisions for this project, in lightweight
MADR style (Status / Context / Decision / Consequences). The authoritative rule set
derived from these decisions lives in `CLAUDE.md` (Architecture Decisions section);
each ADR records the *why* behind those rules.

| # | Title | Status | Decided |
|---|---|---|---|
| [0001](0001-basic-token-authentication.md) | HTTP Basic token for register/sign-in | Accepted | 2025-12-17 |
| [0002](0002-dual-secret-token-pair.md) | Dual-secret access/refresh token pair with `type` claim | Accepted | 2025-12-17 |
| [0003](0003-two-phase-upload-contract.md) | Two-phase upload with `temp_` → `granted_` prefix state machine | Accepted | 2025-12-17 |
| [0004](0004-transaction-pattern-selection.md) | Transaction pattern selection per multi-write | Accepted | 2025-12-17 |
| [0005](0005-local-disk-storage.md) | Local disk storage served by ServeStaticModule | Accepted | 2025-12-17 |
| [0006](0006-schema-policy-and-migration-adoption.md) | `synchronize: false` + manual schema, migrations to be adopted | Accepted | 2026-07-22 |
| [0007](0007-ownership-checks-without-rbac.md) | Ownership checks without RBAC | Accepted | 2026-07-22 |
| [0008](0008-opt-in-cors.md) | Opt-in CORS via `CORS_ORIGIN` | Accepted | 2026-07-22 |
| [0009](0009-rest-only-api-with-swagger.md) | REST-only API layer documented with Swagger | Accepted | 2025-12-17 |
| [0010](0010-frontend-split-and-api-surface-freeze.md) | Frontend split and API surface freeze | Accepted | 2026-07-23 |
| [0011](0011-error-code-contract.md) | Machine-readable error-code contract | Accepted | 2026-07-23 |
| [0012](0012-refresh-cookie-rotation.md) | Refresh token as httpOnly cookie with rotation and reuse detection | Accepted | 2026-07-24 |
| [0013](0013-rbac-and-audit-log.md) | Role-based access control and audit log | Accepted | 2026-07-25 |
| [0014](0014-node-pnpm-version-pinning.md) | Node.js and pnpm version pinning | Accepted | 2026-07-25 |
| [0015](0015-docker-and-compose.md) | Docker and docker-compose for local development | Accepted | 2026-07-25 |
| [0016](0016-github-actions-ci.md) | Continuous integration with GitHub Actions | Accepted | 2026-07-25 |
| [0017](0017-logging-conventions.md) | Logging conventions with Nest's built-in Logger | Accepted | 2026-07-25 |
| [0018](0018-orphan-temp-file-cleanup.md) | Scheduled orphan temp-file cleanup | Accepted | 2026-07-26 |
| [0019](0019-upload-claim-idempotency.md) | Upload duplicate-submission policy — attach filename as a one-shot claim token | Accepted | 2026-07-27 |
| [0020](0020-account-deletion-cascade.md) | Deletion policy — confirmed account cascade over soft delete | Accepted | 2026-07-30 |
| [0021](0021-list-query-search-filter-sort.md) | List query — whitelisted sort, ILIKE title search, creator filter | Accepted | 2026-07-30 |
| [0022](0022-admin-console-import-from-chat-project.md) | Admin console imported from the Chat Project as a modification base | Accepted | 2026-07-30 |
| [0023](0023-board-domain-schema.md) | Board domain schema — post and comment | Accepted | 2026-07-30 |
| [0024](0024-account-cascade-fk-refusal.md) | Account cascade — a typed refusal instead of an FK-violation 500 | Accepted | 2026-07-31 |

Convention: new ADRs take the next number, `NNNN-short-kebab-title.md`, with a
Korean sibling `NNNN-short-kebab-title.ko.md`. Superseding an ADR flips its status
to `Superseded by NNNN` rather than editing the original decision.

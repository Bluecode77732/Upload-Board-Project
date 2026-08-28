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
| [0025](0025-file-visibility-and-media-expansion.md) | File visibility, access-controlled serving, and media-type expansion | Accepted — implemented (0026, 0027) | 2026-07-31 |
| [0026](0026-file-visibility-implementation.md) | File visibility implementation — serving mechanism, metadata filtering, and the content/metadata disclosure split | Accepted | 2026-08-01 |
| [0027](0027-media-type-expansion-implementation.md) | Media-type expansion implementation — type-specific upload fields | Accepted | 2026-08-01 |
| [0028](0028-access-token-role-claim.md) | Access token carries a `role` claim | Accepted | 2026-08-05 |
| [0029](0029-storage-port-adapter.md) | Storage port-adapter — `FileStorage` interface, amends 0005 | Accepted | 2026-08-07 |
| [0030](0030-container-non-root-and-arch-stance.md) | Container runs non-root; distroless and multi-arch deferred | Accepted | 2026-08-08 |
| [0031](0031-health-and-readiness-endpoints.md) | Liveness and readiness endpoints | Accepted | 2026-08-08 |
| [0032](0032-migration-as-separate-deploy-step.md) | Migrations run as a separate deploy step, not on container boot | Accepted | 2026-08-08 |
| [0033](0033-secrets-delivery-target.md) | Secrets delivery target — Kubernetes Secrets, AWS Secrets Manager deferred | Accepted (design-only) | 2026-08-08 |
| [0034](0034-https-termination-stance.md) | HTTPS termination happens at the ingress, not in the app | Accepted (design-only) | 2026-08-08 |
| [0035](0035-arm64-bcrypt-source-rebuild.md) | arm64 support — bcrypt already works (verified), `onlyBuiltDependencies` kept as a safety net, corrects 0030 | Accepted | 2026-08-12 |
| [0036](0036-s3-presigned-content-redirect.md) | S3 presigned-URL redirect for `GET /file/:id/content`, extends 0029 | Accepted — implemented | 2026-08-13 |
| [0037](0037-helm-chart-scaffold.md) | Helm chart — scaffold landed, not yet project-specific | Accepted (scaffold only) | 2026-08-11 |
| [0038](0038-terraform-iac-scaffold.md) | Terraform IaC — upstream EKS+Istio example landed, not yet project-specific | Accepted (scaffold only) | 2026-08-11 |
| [0039](0039-db-tls-verification-stance.md) | Production DB TLS — remove `rejectUnauthorized: false`, verify via a real CA when a target exists | Accepted | 2026-08-15 |
| [0040](0040-persisted-media-type-for-playback.md) | Persisted `mediaType` column for playback tag selection, extends 0025/0027 | Accepted | 2026-08-16 |
| [0041](0041-helm-chart-project-adaptation.md) | Helm chart project adaptation — lifting ADR 0037's deferral | Accepted | 2026-08-17 |
| [0042](0042-k8s-helm-directory-consolidation.md) | Consolidate `k8s/` and `helm/` — one Kubernetes directory, not two | Accepted | 2026-08-17 |
| [0043](0043-terraform-project-adaptation.md) | Terraform project adaptation — real AWS resources, verified via live apply, amends 0038 | Accepted — implemented (apply status changes independently of this ADR; see ROADMAP §9) | 2026-08-18 |
| [0044](0044-terraform-three-state-split.md) | Terraform three-state split — cluster/addons/app-infra lifecycle separation, amends 0043 | Accepted — implemented (apply status changes independently of this ADR; see ROADMAP §9) | 2026-08-19 |
| [0045](0045-audit-log-target-type.md) | Audit log `targetType` — a discriminator for the polymorphic `targetId`, amends 0013 | Accepted — implemented | 2026-08-24 |
| [0046](0046-deploy-sequence-automation.md) | Deploy-sequence automation — a local shell script, Terraform + Helm only | Accepted — implemented | 2026-08-27 |

Convention: new ADRs take the next number, `NNNN-short-kebab-title.md`, with a
Korean sibling `NNNN-short-kebab-title.ko.md`. Superseding an ADR flips its status
to `Superseded by NNNN` rather than editing the original decision.

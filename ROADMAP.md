# Roadmap

> 한국어 버전: [ROADMAP.ko.md](ROADMAP.ko.md)

Priority tiers, not dates — this is a solo portfolio project with no release schedule.
Each item lands as its own dedicated task (Scope Discipline in `CLAUDE.md`: no
drive-by fixes bundled into unrelated changes). Known gaps are documented deviations —
do **not** replicate them in new code.

## Recently Landed (2026-07-22, on `dev`)

- **Ownership checks** ([ADR 0007](ADR/0007-ownership-checks-without-rbac.md)) —
  self-only user writes, creator-only file writes (`0549ca4`).
- **`GET /file` pagination** — `GetFilesDto` (`take` 1–100 default 20, `skip`
  default 0) (`0549ca4`).
- **Opt-in CORS** ([ADR 0008](ADR/0008-opt-in-cors.md)) — `CORS_ORIGIN` env var
  (`0549ca4`).
- **`pnpm lint` restored** — missing `typescript-eslint` devDependency declared
  (`48ab8b7`); Prettier applied repo-wide (`7bbc6b6`). ~45 pre-existing lint errors
  remain (see Known Gaps).
- **Documentation set** — README rewrite, ARCHITECTURE, CHANGELOG, ROADMAP,
  CONTRIBUTING, ADR/, with Korean siblings (this change).

## Next (decided 2026-07-22)

1. **TypeORM migration adoption** ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md))
   — `migration:generate`/`migration:run` scripts, a `DataSource` CLI config, and
   `src/migrations/`. Unblocks every schema-touching item below. Until it lands, the
   schema is applied manually.
2. **RBAC** — role column on `UserEntity` (schema change → blocked on item 1) plus a
   role-aware guard composed with `JwtAuthGuard`. Layers on top of the ownership
   checks, not instead of them.

## Later (candidates, not yet committed to)

Carried over from the original README's "Scale Up In The Future" list plus gaps found
during review — each needs an Introduction Analysis (`CLAUDE.md`) before adoption:

- File type validation (mimetype/extension allowlist) — see Known Gaps below; the
  most security-relevant candidate.
- Physical file cleanup: delete the disk file when its `FileEntity` row is deleted;
  sweep orphaned `temp_` files never claimed by `POST /file/uploadFile`.
- Multi-file upload.
- Video compression/processing.
- Progress tracking for large uploads.
- User-specific storage paths.
- CI (lint + test on push) — currently no pipeline exists at all.
- Logging infrastructure (structured logger, error tracking) — currently none.
- Cloud deploy (AWS was the original candidate) — would reopen
  [ADR 0005](ADR/0005-local-disk-storage.md) (local disk storage).

## Known Gaps (documented, not yet scheduled)

| Gap | Detail | Risk |
|---|---|---|
| `pnpm lint` fails | Lint runs (restored in `48ab8b7`) but exits with 45 errors / 5 warnings — mostly `unbound-method` in spec files plus `no-unsafe-*`/`no-floating-promises`. Working them down to zero is the remaining task; until then, introduce no new errors | No clean lint baseline |
| No mimetype/extension validation | `POST /upload/attach` checks size only; extension trusted from `originalname` | Any file type accepted despite the "video" intent |
| `GET /file` doesn't join `creator` | List responses omit creator info (single-file `GET /file/:id` includes it) | Inconsistent response shape |
| `.env.example` lacks `BASE_URL` | Optional var (defaults to `http://localhost:3000`) exists in the Joi schema only | Discoverability |
| `upload.controller.ts` comment says "300MB" | Actual limit is 100,000,000 bytes (100 MB) | Misleading comment |
| Deleting a user with files hits an FK constraint | `FileEntity.creator` is `nullable: false`; no cascade path defined for `DELETE /user/:id` | Confusing 500 for that case |
| License mismatch | `package.json` says `UNLICENSED`; the old README claimed MIT | Needs an explicit decision |

## Non-Goals

Per the ADRs, these are settled — do not propose without an explicit request:
session-based auth or a single JWT secret ([ADR 0002](ADR/0002-dual-secret-token-pair.md));
S3/CDN/streaming ([ADR 0005](ADR/0005-local-disk-storage.md)); GraphQL/WebSocket/gRPC
([ADR 0009](ADR/0009-rest-only-api-with-swagger.md)); `synchronize: true`
([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.md)).

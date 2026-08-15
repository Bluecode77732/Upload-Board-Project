# ADR 0005: Local Disk Storage Served by ServeStaticModule

- Status: Accepted
- Date: 2025-12-17
- 한국어: [0005-local-disk-storage.ko.md](0005-local-disk-storage.ko.md)

## Context

Uploaded videos need physical storage and a public URL. Cloud object storage (S3 and
friends) adds credentials, SDKs, and cost to a local/portfolio project with no deploy
target; the project's learning goal was Multer's disk handling itself.

## Decision

- Multer `diskStorage` writes to `file/temp`; promoted files live in `file/upload`
  (see [ADR 0003](0003-two-phase-upload-contract.md)).
- `ServeStaticModule` serves the `file/` directory at the `/file` URL prefix
  (`rootPath: join(process.cwd(), 'file')`, `serveRoot: 'file'`).
- Public URLs are composed as `{BASE_URL}/{filePath}` in `FileService.toResponse()` —
  presentation stays out of the entity.
- Upload constraint: single multipart field `video`, `fileSize` limit 100,000,000
  bytes (100 MB).

**Never suggest** (without explicit request): S3/cloud storage, streaming/chunked
upload, CDN.

## Consequences

- Zero external dependencies; the whole stack runs from a checkout + PostgreSQL.
- Storage scales only with the host disk; horizontal scaling or multi-instance deploys
  would break silently (each instance has its own `file/` tree) — acceptable because
  no deploy target exists.
- Static serving exposes both `temp/` and `upload/` folders, which is why the filename
  prefix carries the lifecycle state.
- Deleting a `FileEntity` row does **not** delete the physical file — physical
  cleanup is a known gap tracked in [ROADMAP.md](../ROADMAP.md).

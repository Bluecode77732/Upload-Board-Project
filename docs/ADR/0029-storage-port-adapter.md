# ADR 0029: Storage Port-Adapter — `FileStorage` Interface

- Status: Accepted
- Date: 2026-08-07
- Amends: [ADR 0005](0005-local-disk-storage.md) (local disk storage)
- 한국어: [0029-storage-port-adapter.ko.md](0029-storage-port-adapter.ko.md)

## Context

ADR 0005 accepted local disk storage on the explicit premise "no deploy target
exists," and recorded the resulting risk itself: "horizontal scaling or
multi-instance deploys would break silently (each instance has its own `file/`
tree)." [ROADMAP.md](../ROADMAP.md) §4 (Architecture direction) already named the
fix as a decided future goal — a `FileStorage` interface isolating physical-file
operations so the local-disk implementation can be swapped for S3 — and Stage 4
now names that fix as the immediate pre-deployment task (K8s · Helm · S3). This
ADR is the "code-first slice" of that task: the interface and both adapters land
now, ahead of the Kubernetes/Helm work and ahead of any real AWS credentials
existing. The premise ADR 0005 stood on is what changed, not the local storage
mechanics themselves — those are ported behind the new interface unchanged.

**ISP clearance.** CLAUDE.md's Interface Segregation rule is "do not introduce a
service-interface layer until a real second implementation exists." `S3Storage`
is that second implementation, built and unit-tested in this same change (SDK
mocked, since no bucket exists yet) — so introducing the interface now is the
rule's own trigger firing, not an exception to it.

**Physical file touchpoints found while reading the code** (Structure Analysis,
CLAUDE.md > Analysis Protocol) — every place a request handler currently talks to
the filesystem directly, all of which the port must cover for the interface to be
load-bearing rather than partial:

- `backend/upload/upload.module.ts` + `upload.controller.ts` — Multer `diskStorage`
  writes the very first bytes of a temp upload directly to `file/temp`, inside
  Express middleware, before any service code runs.
- `backend/file/file.service.ts` `uploadFile()` — `access()` (ADR 0019 claim
  precondition) and `rename()` (temp → granted promotion) inside the QueryRunner
  transaction.
- `backend/file/file-content.controller.ts` — `stat()` + `createReadStream()` +
  Range parsing/206/416 (ADR 0025/0026).
- `backend/common/unlink-stored-files.ts` — best-effort post-commit `unlink()`,
  called from both `FileService.deleteFile` and `UserService.remove`'s cascade.
- `backend/temp-cleanup/temp-cleanup.service.ts` (ADR 0018) — `readdir()` +
  `stat()` + `unlink()` sweeping `file/temp` on a cron.

Four of these sit in three different modules (`UploadModule`, `FileModule`,
`TempCleanupModule`, plus `UserModule` as a caller of the shared unlink helper).
A port that only covers `FileService` would leave the other three still bound to
local disk, defeating the point.

## Decision

### D1 — Interface shape: domain-shaped, not S3-shaped

Method names speak this app's own state machine (`saveTemp`, `promote`, ...), not
generic object-store verbs (`put`/`copy`/`get`). The alternative considered was a
`put(key, stream)` / `copy(src, dest)` / `get(key, range)` shape mirroring the S3
SDK 1:1 — rejected because it would relocate the `temp_`→`granted_` naming
transform (currently `FileService.toStoredPath`, a pure function) into a
thinner-but-duplicated form on every adapter, for a savings that only matters if
a third, non-domain-shaped adapter ever arrives. No such adapter is planned.
`FileService` keeps owning the naming transform; the port only moves bytes for
keys `FileService` (or `UploadService`) already computed — see the method list
below.

### D2 — Module placement: new `StorageModule`

Follows the precedent already in this codebase: `TempCleanupModule` (ADR 0018)
carved itself out as an "operational module" rather than being bolted onto
`UploadModule`, specifically because a cross-cutting filesystem concern doesn't
belong inside a single domain module. `FileStorage` is the same shape of problem
one level lower — it is infrastructure, consumed by three domain modules
(`UploadModule`, `FileModule`, `TempCleanupModule`) plus `UserModule` (account
cascade). Putting it inside `FileModule` (the alternative considered) was
rejected because CLAUDE.md states `FileModule` "owns file *metadata* only" —
folding physical byte operations in would contradict that line directly, not
just stretch it.

`StorageModule` exports a `FILE_STORAGE` DI token (interfaces have no runtime
representation, so a token is required — standard Nest pattern, same shape as
any other cross-module export). Consuming modules `imports: [StorageModule]` and
inject by token; no consuming module re-declares the provider in its own
`providers[]` (Structure Analysis checklist).

### D3 — Adapter selection: a single `STORAGE_DRIVER` env var

`STORAGE_DRIVER: 'local' | 's3'`, Joi-validated in the existing single schema in
`app.module.ts`, default `'local'`. Selected via a `useFactory` provider in
`StorageModule` that reads `ConfigService` and constructs the matching adapter.
The alternative considered — a namespaced `registerAs('storage', ...)` config
object grouping driver/bucket/region — was rejected: this repo has one flat Joi
schema for every env var today (Architecture Decisions > Config), and
`registerAs` would be a second, unprecedented configuration pattern introduced
for exactly one feature. Two more vars gate on it: `S3_BUCKET` and `AWS_REGION`,
required only `when('STORAGE_DRIVER', { is: 's3', then: Joi.required() })`.
AWS credentials themselves are deliberately **not** added to the Joi schema or
read via `ConfigService` — `S3Storage` constructs `new S3Client({ region })` with
no explicit credentials, so the AWS SDK's own default provider chain (env vars,
shared config, IAM role) resolves them. This isn't a second exception to
"`ConfigService` only" (Architecture Decisions > Config) — our code never reads
those values itself, so there is no `process.env` access to govern; the SDK's
credential resolution is opaque to our config layer, same as `pg`'s own driver
internals are.

### D4 — `UploadModule` gains a service; CLAUDE.md's "no service" line is revised

**Background.** CLAUDE.md's Module Responsibility section states `UploadModule`
"has no service and no DB access — keep it that way," reflecting that today's
Multer `diskStorage` writes bytes to disk inside Express middleware, before any
Nest service runs. The stated purpose of this ADR is closing the multi-instance
gap ADR 0005 recorded. If the very first byte of a temp upload still lands only
on local disk — Multer `diskStorage` writing directly, no port involved — then
under `STORAGE_DRIVER=s3` an `attach` handled by instance A and the follow-up
`POST /file` handled by instance B still cannot find the file: the claim check in
`FileService.uploadFile` reads through the port (instance-independent, S3-backed),
but the bytes it's checking for were never written through the port at all. The
gap ADR 0005 named would only be half-closed, and the half that's left is exactly
the one the ADR exists to close.

**Reason.** Closing that gap requires `UploadModule` to call
`storage.saveTemp(key, buffer)` — which requires a service, which the current
"no service" line forbids outright. This is a real conflict between an existing
rule and this ADR's own stated purpose, not a stylistic preference, so it is
resolved here rather than worked around.

**Decision.** `UploadModule` gains a thin `UploadService`: Multer's storage
engine switches from `diskStorage` to `memoryStorage` (the interceptor config in
`upload.controller.ts` is otherwise unchanged — same fields, same allowlist, same
100MB limit), and `UploadService.stageTemp(file)` generates the
`temp_{uuid}_{timestamp}.{ext}` name (the same generation Multer's `diskStorage`
callback does today, moved verbatim) and calls `storage.saveTemp(name, file.buffer)`.
The controller calls this service instead of reading `file.filename` off a
disk-written Multer file. **CLAUDE.md's Module Responsibility section is revised
in the same change**: `UploadModule` now reads "owns the physical *temp* write
only, through the injected `FileStorage` port — a thin service, not a
metadata/DB layer" in place of "no service and no DB access."

**Vision.** This keeps the module's responsibility exactly as narrow as before —
it still knows nothing about `FileEntity`, ownership, or claims — while making
"physical file" genuinely mean "physical file, wherever the configured adapter
puts it," which is the actual point of a port-adapter. The alternative (leave
`diskStorage` as-is, accept that `STORAGE_DRIVER=s3` only half-works) was
rejected as building a port that can't do the one thing it exists for.

**Consequence, stated plainly.** `memoryStorage` buffers the whole upload (up to
the existing 100MB cap) in process memory for the duration of one request,
instead of Multer streaming it straight to disk with near-zero memory overhead.
This is a real resource cost, bounded by the existing size limit, accepted here
as the trade for the multi-instance correctness that is this ADR's whole point —
not a hidden regression. Revisit if the 100MB cap itself changes or memory
pressure is measured, not preemptively (Engineering Principles > Avoid Premature
Optimization).

### D5 — Interface grows two methods beyond the original five-verb sketch

`existsTemp` (split out of a combined "save/check" verb, since `FileService`'s
ADR 0019 claim precondition needs a bytes-exist check independent of writing) and
`listTemp` (new — discovered while tracing `TempCleanupService`, which currently
does `readdir()` + `stat()` directly and has no equivalent today). Both are
necessary for the port to actually cover the five touchpoints found above, not
scope creep: leaving `listTemp` out would mean the orphan sweep (ADR 0018) keeps
reading local disk regardless of `STORAGE_DRIVER`, silently stopping under `s3`
with no error — exactly the kind of silent multi-instance breakage this ADR
exists to remove.

Final shape:

```
saveTemp(tempKey, data: Buffer): Promise<void>
existsTemp(tempKey): Promise<boolean>
promote(tempKey, grantedKey): Promise<void>
stat(key): Promise<{ size: number }>
createReadStream(key, range?: { start; end }): Promise<Readable>
unlink(keys: string[]): Promise<{ deleted: number; failures: { key; reason }[] }>
listTemp(): Promise<{ key: string; mtimeMs: number }[]>
```

`grantedKey`/`key` are the same string `FileEntity.filePath` already stores
today (`file/upload/granted_...`) — the port does not introduce a second naming
scheme; `LocalDiskStorage` joins it under `process.cwd()`, `S3Storage` uses it
directly as the object key.

### D6 — Explicitly out of scope for this ADR

- **Switching production to S3.** `STORAGE_DRIVER` defaults to `local`; nothing
  in this change requires or assumes a real bucket. That switch is Stage 4's
  cloud-native infrastructure task (ROADMAP.md), with its own ADR.
- **`ServeStaticModule`'s static `file/temp` route.** It keeps serving local disk
  unconditionally. Under `STORAGE_DRIVER=s3` this route serves nothing (temp
  bytes never touch local disk) — a known, accepted gap, not a crash: Express
  `serve-static` 404s a missing file, it does not error. Nothing today's flow
  depends on actually reads through this route (`FileResponseDto.fileUrl` has
  pointed at `GET /file/:id/content` since ADR 0025/0026, never a static temp
  URL), so no behavior a client relies on changes. Recorded in ROADMAP as a
  residual for the eventual S3 cutover to close.
- **Schema changes.** None — `FileEntity.filePath` keeps its exact current
  meaning and values.
- **Frontend.** Not touched; this is a backend-internal refactor with no API
  surface change.

## Consequences

- Local-disk behavior (`temp_`/`granted_` state machine, Range/206/416
  streaming, post-commit best-effort unlink with `warn`-logged failures) is
  preserved exactly, now behind `LocalDiskStorage` — verified by regression
  (existing unit suites adapted to mock the port instead of `fs/promises`, plus
  `pnpm test:e2e`).
- `S3Storage` is real, adapter-complete code, verified only by unit tests against
  a mocked `@aws-sdk/client-s3` client — it has never run against a live bucket.
  Treat it as unverified-in-anger until the Stage 4 cutover exercises it for
  real.
- New runtime dependency: `@aws-sdk/client-s3` (Apache-2.0, checked via
  `pnpm info` before adding — no copyleft concern).
- `backend/common/unlink-stored-files.ts` is retired: its guarded, batched
  unlink logic moves into `LocalDiskStorage.unlink()`, since "which paths are
  safe to unlink" is now an adapter-local concern (an S3 adapter's equivalent
  guard is a key-prefix check, not a folder check) rather than a shared helper
  two services imported directly.
- `UserModule` and `TempCleanupModule` both gain a dependency on `StorageModule`
  (via the injected `FILE_STORAGE` token) where neither touched storage directly
  before — `UserModule` for the account-cascade unlink,`TempCleanupModule` for
  the sweep. Both are additive `imports[]`, not a change to either module's own
  public contract.
- CLAUDE.md is updated in the same change: the Module Responsibility entry for
  `UploadModule` (D4 above), the "Physical upload change" and "Deletion path
  change" concern-to-entrypoint map rows (now point through `UploadService` /
  the storage port), and a new "Storage adapter change" map row.

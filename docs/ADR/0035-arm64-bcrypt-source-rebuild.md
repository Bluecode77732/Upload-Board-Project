# ADR 0035: arm64 Support — bcrypt Already Works, `onlyBuiltDependencies` Kept as a Safety Net

- Status: Accepted
- Date: 2026-08-12
- Amends: [ADR 0030](0030-container-non-root-and-arch-stance.md) (Decision: "Target
  architecture stays x64 for now" — corrected below, not just deferred)
- 한국어: [0035-arm64-bcrypt-source-rebuild.ko.md](0035-arm64-bcrypt-source-rebuild.ko.md)

## Context

ADR 0030 recorded that `bcrypt` ships prebuilt binaries for glibc/x64 only, and
deferred deciding how to support arm64 to "the eventual Terraform ADR" once a real
deploy architecture existed. That precondition hasn't happened — instead, the need
surfaced from a different direction: publishing this image with
`docker buildx build --platform linux/amd64,linux/arm64` for a unified image across
architectures (a personal Docker Hub push, `bluecode1775/sharenpo`), independent of
the AWS/Terraform node-group decision ADR 0030 anticipated.

Investigating also surfaced that pnpm 10 blocks dependency install scripts by
default unless explicitly approved (`pnpm install`'s own output:
`Ignored build scripts: @scarf/scarf, bcrypt, unrs-resolver`). Combined with ADR
0030's "x64-only prebuild" claim, this first read as two compounding problems on
arm64: no prebuild *and* the install script that would fall back to compiling from
source was blocked.

**This ADR originally shipped acting on that reading — it was wrong.** Verifying it
end to end (`docker run --platform linux/arm64 node:24.8.0 sh -c "npm install
bcrypt"`, then `require('bcrypt').hashSync(...)` inside that same container) showed:
- The install log shows only `node-gyp-build` running — no `gyp`/`make`/compile
  output at all. `node-gyp-build` is bcrypt's install helper for the
  `prebuildify` convention: it looks for a matching prebuilt `.node` binary
  already bundled inside the npm package itself, and only falls back to compiling
  when none exists.
- `bcrypt@6.0.0` bundles a working `linux-arm64`/glibc prebuild, not just
  `x64` — ADR 0030's premise doesn't hold for the version this project has pinned.
- `require('bcrypt').hashSync(...)` succeeded under QEMU emulation, producing a
  real hash — confirming the bundled prebuild is genuinely used, not merely
  present.
- Because the prebuild is resolved by `node-gyp-build` reading files already
  unpacked from the tarball — not by an install-time *script* — pnpm's
  script-blocking was never actually a threat to bcrypt on either architecture.
  Unpacking a package's files happens regardless of whether its lifecycle scripts
  are permitted to run; only the scripts themselves are what pnpm blocks.

## Decision

- **Correct the record**: arm64 needs no compile step for `bcrypt` and none was
  ever going to happen through the mechanism this ADR originally described.
  ADR 0030's "target architecture stays x64" constraint is retired, not merely
  amended — verified working, not just no-longer-blocking.
- **Keep `package.json`'s `pnpm.onlyBuiltDependencies: ["bcrypt"]` anyway**, as a
  zero-cost safety net: it does nothing today (the prebuild path never needed the
  script), but if a future `bcrypt` upgrade or a platform this project doesn't
  currently target ever lacks a bundled prebuild, the fallback compile is already
  pre-approved instead of silently skipped.
- No Dockerfile change beyond a comment (corrected below) — nothing about the
  build needs to differ per architecture.

## Alternatives rejected

- **Swap to `bcryptjs`** — no longer has a motivating problem to solve; not
  pursued.
- **Revert `onlyBuiltDependencies` entirely** — rejected in favor of keeping it as
  a safety net (see Decision): it costs nothing and guards a real, if currently
  dormant, failure mode (a future version/platform without a bundled prebuild
  would otherwise fail silently-ish, via the same blocked-script path this ADR
  investigated).

## Consequences

- `linux/arm64` builds use bcrypt's bundled prebuild, same as `linux/amd64` — no
  compile step, no meaningful build-time difference between the two platforms for
  this dependency. Verified via an isolated `npm install bcrypt` +
  `require('bcrypt').hashSync(...)` run under `--platform linux/arm64` emulation,
  not yet via a full project `docker buildx build` (still worth doing at least
  once to confirm the same holds inside this Dockerfile's actual `pnpm install`).
- Retracts ADR 0030's "every bcrypt prebuild is x64" claim for the currently
  pinned `bcrypt@6.0.0` — ADR 0030's other decisions (non-root user, `HEALTHCHECK`,
  distroless deferred) are untouched.
- Process note: the original version of this ADR was written and committed before
  running the verification that later contradicted it — Hallucination Prevention's
  "verify every assumption with actual output" applies to ADRs, not only code.
- No schema, entity, or API surface change.

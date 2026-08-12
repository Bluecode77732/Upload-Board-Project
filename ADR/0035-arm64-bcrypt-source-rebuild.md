# ADR 0035: arm64 Support — Rebuild bcrypt from Source via `onlyBuiltDependencies`

- Status: Accepted
- Date: 2026-08-12
- Amends: [ADR 0030](0030-container-non-root-and-arch-stance.md) (Decision: "Target
  architecture stays x64 for now, documented as a known constraint, not solved")
- 한국어: [0035-arm64-bcrypt-source-rebuild.ko.md](0035-arm64-bcrypt-source-rebuild.ko.md)

## Context

ADR 0030 recorded that `bcrypt` ships prebuilt binaries for glibc/x64 only, and
deferred deciding how to support arm64 to "the eventual Terraform ADR" once a real
deploy architecture existed. That precondition hasn't happened — instead, the need
surfaced from a different direction: publishing this image with
`docker buildx build --platform linux/amd64,linux/arm64` for a unified image across
architectures (a personal Docker Hub push, `bluecode1775/sharenpo`), independent of
the AWS/Terraform node-group decision ADR 0030 anticipated.

Investigating the failure mode surfaced a second, previously unrecorded fact: pnpm 10
blocks dependency install scripts by default unless explicitly approved
(`pnpm install`'s own output: `Ignored build scripts: @scarf/scarf, bcrypt,
unrs-resolver`). This does **not** currently break anything on amd64 — verified
locally (`node -e "require('bcrypt').hashSync(...)"` succeeds against the existing
`node_modules`) — because bcrypt's prebuilt binary for glibc/x64 is bundled in its
npm package and loaded without needing its own install script. On arm64, where no
prebuild exists, that same blocked script is what would normally fall back to
compiling from source — so the script being blocked and no architecture-specific
prebuild existing compound into the same failure on arm64 specifically.

## Decision

- **`package.json`'s `pnpm.onlyBuiltDependencies` now lists `bcrypt`**, explicitly
  approving its install script to run. On amd64/glibc this changes nothing
  (prebuilt binary path, already verified working). On arm64, the now-permitted
  script falls back to compiling from source via `node-gyp` — the `development`
  build stage already carries the full compiler toolchain this needs (`node:24.8.0`,
  not `-slim`), since bcrypt is only ever built there; `production` only copies the
  already-built `node_modules`.
- No Dockerfile change was needed beyond a comment: Docker Hub's official
  `node:24.8.0` tag already resolves to the correct base per target platform under
  `buildx --platform`, and the full (non-slim) variant ships the compilers a source
  build needs.

## Alternatives rejected

- **Swap to `bcryptjs`** (pure JS, no native binding, identical results on every
  platform without a compile step) — considered and set aside for now, not ruled
  out. It removes the architecture problem entirely but is measurably slower
  (pure-JS hashing vs. a native binding) and would need `auth.service.spec.ts` and
  related mocks re-verified against the new module. Kept as the fallback if the
  source-rebuild path proves too slow or unreliable under `buildx`'s QEMU emulation.
- **Leave ADR 0030's x64-only stance as-is** — rejected: it would leave the
  multi-platform publish this ADR exists to support broken or silently producing an
  image with no working password hashing on arm64.

## Consequences

- `linux/arm64` builds now attempt a `node-gyp` compile of `bcrypt` during the
  `development` stage's `pnpm install` — **not yet verified against real arm64
  hardware or `buildx`'s QEMU emulation**, matching ADR 0030's own precedent of
  recording an unverified constraint rather than asserting it works. Build time for
  the arm64 target will likely increase (native compile under emulation vs. a
  prebuilt binary fetch).
- `linux/amd64` behavior is unchanged (verified: bcrypt continues to load its
  prebuilt binary).
- Amends ADR 0030's "target architecture stays x64" bullet only; ADR 0030's other
  decisions (non-root user, `HEALTHCHECK`, distroless deferred) are untouched.
- No schema, entity, or API surface change.

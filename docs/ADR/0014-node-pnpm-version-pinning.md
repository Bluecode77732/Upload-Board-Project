# ADR 0014: Node.js and pnpm Version Pinning

- Status: Accepted
- Date: 2026-07-25
- 한국어: [0014-node-pnpm-version-pinning.ko.md](0014-node-pnpm-version-pinning.ko.md)

## Context

`pnpm-lock.yaml` pins every dependency, but nothing pinned the *toolchain*:
CLAUDE.md documented Node and pnpm as unpinned (no `.nvmrc`, no `engines`
field). Environment drift — a contributor or a build box on a different Node or
pnpm major — is a latent, hard-to-diagnose failure source, and it becomes a
direct one the moment a reproducible build target exists. Pinning the toolchain
is the first Stage 1 foundation task and a precondition for the two that follow:
the Docker base-image tag and the CI `setup-node`/pnpm versions both need a
single source of truth to derive from.

## Decision

- **`.nvmrc` = `24.8.0`** — the exact runtime the suite is verified on (the
  Node 24 "Krypton" LTS line). `nvm`/`fnm` users get the recommended version with
  `nvm use`.
- **`engines` floor** — `node >= 24`, `pnpm >= 10`. A floor, not an equality:
  pnpm's `engine-strict` is left **off**, so `engines` warns rather than blocks —
  a matching-or-newer toolchain installs cleanly, while the field still documents
  the minimum and drives Docker/CI.
- **`packageManager: "pnpm@10.14.0"`** — Corepack's exact pin. Corepack ships
  with Node, so this needs no extra tool, and it is the single source the Docker
  image and CI read the pnpm version from.
- **Scope: pin only.** Consuming these values (Docker/compose, CI) are their own
  Stage 1 tasks with their own records; this ADR just establishes the source.

## Alternatives rejected

- **Exact `engines` equality (`node: "24.8.0"`)** — too brittle: every patch
  bump would fail installs for no benefit. `.nvmrc` already carries the exact
  recommendation; `engines` is the compatibility floor.
- **Volta pin** — another tool each contributor must install. Corepack ships with
  Node and `.nvmrc` is the `nvm`/`fnm` standard; no new prerequisite.
- **`engine-strict = true`** — hard-blocks installs on a version mismatch. Too
  aggressive for a portfolio project this early; tightening it is a later call
  once CI enforces the floor anyway.
- **Leave unpinned** — the documented gap; blocks reproducible Docker images and
  a meaningful CI, and keeps environment drift a live failure source.

## Consequences

- CLAUDE.md's "Reproducible Builds" note is updated: the toolchain is now pinned
  (`.nvmrc` + `engines` + `packageManager`), no longer "versions are NOT pinned".
- The Docker base-image tag (Stage 1) and CI toolchain versions now derive from a
  single source rather than being chosen ad hoc.
- `engines` is advisory (`engine-strict` off): it surfaces a warning on a
  too-old toolchain, it does not fail the install. Enforcement arrives with CI.
- Bumping the runtime is a three-line change (`.nvmrc`, `engines.node`, and — for
  a pnpm bump — `packageManager` + `engines.pnpm`), reviewed like any other.

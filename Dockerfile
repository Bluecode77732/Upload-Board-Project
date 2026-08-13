# syntax=docker/dockerfile:1

# ============================================================================
# development — full image, has the compilers a native build needs.
# Node/pnpm are pinned per ADR 0014 (.nvmrc / package.json packageManager), so
# this tag is the single source of truth for both.
# ============================================================================
FROM node:24.8.0 AS development
WORKDIR /app
RUN corepack enable

# Without this, pnpm's own confirmation prompts (e.g. "modules directory will
# be removed and reinstalled from scratch" on a store-dir mismatch between the
# install step's --store-dir and a later plain `pnpm build`) block forever: a
# Docker RUN step has no stdin/TTY to answer (Y/n), so the build just hangs.
# CI=true is the standard signal pnpm (and most JS CLIs) checks to skip these.
ENV CI=true

# Manifests only, before the rest of the source — this layer (and the
# install below) stays cached until the lockfile itself changes.
COPY package.json pnpm-lock.yaml ./

# --store-dir + the cache mount keep pnpm's content-addressable store alive
# across builds even when this layer is invalidated by a lockfile change, so
# a dependency bump doesn't re-download every package from the registry.
# Build-time only — nothing here is committed to an image layer.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY . .

# Compile to dist/, then drop dev deps so production only carries prod
# modules. bcrypt needs no arch-specific handling here: it bundles a
# working prebuild for both amd64 and arm64 glibc, resolved by
# node-gyp-build at require-time from files already unpacked from the
# tarball, not via a script — verified under arm64 emulation (ADR 0035,
# corrects ADR 0030's "every bcrypt prebuild is x64" claim).
# Same cache mount as the install step, required again here: `pnpm
# prune` looks up the store path node_modules was linked from, and
# without it mounted it can't verify the link — it prompts to wipe and
# reinstall instead, a prompt with no stdin, which just hangs the build.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm build && pnpm prune --prod

# ============================================================================
# production — slim, no compilers needed; prod node_modules/dist come from
# the development stage above. Distroless was considered (ADR 0030) and
# deferred: an exact Node 24 tag is unverified, and this project has no
# ephemeral-debug-container tooling yet to replace the shell it would remove.
# ============================================================================
FROM node:24.8.0-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=development /app/node_modules ./node_modules
COPY --from=development /app/dist ./dist

# Both upload folders must exist for the temp_ -> granted_ promotion
# contract; a compose volume mounts over this at runtime for persistence.
RUN mkdir -p file/temp file/upload

# Non-root (ADR 0030): a compromised process no longer carries root inside
# the container's user namespace. uid/gid 1001 is arbitrary but fixed, so a
# Linux host bind-mounting ./file (docker-compose.yml, local dev only) can
# chown it to match once; Windows/Mac Docker Desktop's mount layer is
# unaffected.
RUN groupadd --gid 1001 appgroup \
  && useradd --uid 1001 --gid appgroup --no-create-home appuser \
  && chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

# Liveness only (ADR 0031) — a DB outage must not restart an otherwise
# healthy process; that's readiness's (GET /health/ready) job, checked by
# the orchestrator/LB, not by Docker's own restart policy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:3000/health/live',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Migrations are no longer run here (ADR 0032) — a multi-instance boot would
# race `migration:run` against the same database. They run as their own
# step (docker-compose.yml's `migrate` service; a Kubernetes Job in the
# eventual Helm chart) before this container ever starts.
CMD ["node", "dist/main"]

# syntax=docker/dockerfile:1

# Build stage — full image (has compilers for bcrypt's native build). Node/pnpm
# versions are pinned per ADR 0014 (.nvmrc / package.json packageManager), so the
# base tag here has a single source of truth.
FROM node:24.8.0 AS build
WORKDIR /app
RUN corepack enable
# Install with dev deps (nest build needs them). Copying only the manifests first
# keeps this layer cached until the lockfile actually changes.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Compile to dist/, then drop dev deps so the runtime carries prod modules only
# (bcrypt stays prebuilt from this glibc image — no recompile on the slim runtime).
RUN pnpm build && pnpm prune --prod

# Runtime stage — slim (no compilers needed; prod node_modules come from build).
# Distroless was considered (ADR 0030) and deferred: an exact Node 24 tag is
# unverified and this project has no ephemeral-debug-container tooling yet to
# replace the shell it would remove.
FROM node:24.8.0-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Both upload folders must exist for the temp_ -> granted_ promotion contract;
# a compose volume mounts over this at runtime for persistence.
RUN mkdir -p file/temp file/upload

# Non-root (ADR 0030): a compromised process no longer carries root inside the
# container's user namespace. uid/gid 1001 is arbitrary but fixed, so a Linux
# host bind-mounting ./file (docker-compose.yml, local dev only) can chown it
# to match once; Windows/Mac Docker Desktop's mount layer is unaffected.
RUN groupadd --gid 1001 appgroup \
  && useradd --uid 1001 --gid appgroup --no-create-home appuser \
  && chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000
# Liveness only (ADR 0031) — a DB outage must not restart an otherwise-healthy
# process; that is readiness's (GET /health/ready) job, checked by the
# orchestrator/LB, not by Docker's own restart policy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:3000/health/live',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
# Migrations are no longer run here (ADR 0032) — a multi-instance boot would
# race `migration:run` against the same database. They run as their own step
# (docker-compose.yml's `migrate` service; a Kubernetes Job in the eventual
# Helm chart) before this container ever starts.
CMD ["node", "dist/main"]

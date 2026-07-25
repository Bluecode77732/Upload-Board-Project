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
FROM node:24.8.0-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Both upload folders must exist for the temp_ -> granted_ promotion contract;
# a compose volume mounts over this at runtime for persistence.
RUN mkdir -p file/temp file/upload
EXPOSE 3000
# Apply committed migrations (idempotent), then boot. migration:run needs only the
# compiled dist/data-source.js + typeorm CLI (a prod dep) — no nest/pnpm at runtime.
CMD ["sh", "-c", "node node_modules/typeorm/cli.js migration:run -d dist/data-source.js && node dist/main"]

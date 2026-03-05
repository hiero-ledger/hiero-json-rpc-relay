# syntax=docker/dockerfile:1

# Build Stage
# Installs workspace dependencies, compiles TypeScript, and prepares 
# a production-ready package tree.
FROM node:22-alpine AS build

WORKDIR /home/node/app

# Pre-copy manifests to leverage layer caching for dependency installation.
COPY package.json package-lock.json lerna.json ./
COPY packages/config-service/package.json packages/config-service/
COPY packages/relay/package.json           packages/relay/
COPY packages/server/package.json          packages/server/
COPY packages/ws-server/package.json       packages/ws-server/

# Install dependencies using npm ci for deterministic builds.
# Lifecycle scripts are ignored to minimize the security surface.
RUN npm ci --ignore-scripts

# Copy source code and configurations for compilation.
COPY tsconfig.json ./
COPY packages/ packages/

# Compile packages.
RUN npm run build

# Write build-time env to .env.release — a path that is never overridden by
# user volume mounts. Stores npm_package_version required by ConfigService.
RUN printf 'npm_package_version=%s\n' \
        "$(node -p "require('package.json').version")" > .env.release

# Prune development dependencies and runtime artifacts.
RUN npm prune --omit=dev --ignore-scripts

# Remove source code, maps, and type definitions to reduce image footprint.
RUN find packages -mindepth 2 -maxdepth 2 -type d \
        \( -name src -o -name tests -o -name test \) \
        -exec rm -rf {} + ; \
    find packages -name '*.js.map' -delete ; \
    find packages -name '*.d.ts'   -delete

# Strip non-runtime artefacts from production node_modules.
# *.map       — source maps consumed by debuggers, never by Node.js
# *.ts        — TypeScript source already compiled to dist/ (*.d.ts kept: negligible, safe)
# lib.esm/    — ESM variants of CJS packages; this monorepo targets CommonJS exclusively
# *.md        — documentation, not parsed at runtime
RUN find node_modules -name '*.map'    -delete && \
    find node_modules -name '*.ts' -not -name '*.d.ts' -delete && \
    find node_modules -type d -name 'lib.esm' -prune -exec rm -rf {} + && \
    find node_modules -name '*.md'     -delete

# Runtime Stage
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV HEALTHCHECK_PORT=7546

WORKDIR /home/node/app

# Deploy hoisted production dependencies.
COPY --from=build --chown=node:node /home/node/app/node_modules ./node_modules

# Deploy compiled workspace packages.
COPY --from=build --chown=node:node /home/node/app/packages ./packages

# Deploy required static assets.
COPY --chown=node:node docs/openrpc.json ./docs/openrpc.json

# Deploy the build-time version env — isolated from user volume mounts.
COPY --from=build --chown=node:node /home/node/app/.env.release ./.env.release

EXPOSE 7546
EXPOSE 8546
EXPOSE 8547

# Healthcheck targeting the configurable liveness endpoint.
HEALTHCHECK --interval=10s --retries=3 --start-period=25s --timeout=2s \
    CMD wget -q -O- http://localhost:${HEALTHCHECK_PORT}/health/liveness

USER node

# Run Node.js directly as PID 1. Loads .env.release first (build-time vars,
# including npm_package_version), then .env (user runtime config). Variables
# in .env take precedence for any duplicate keys.
ENTRYPOINT ["node", "--env-file=/home/node/app/.env.release"]
CMD ["packages/server/dist/index.js"]

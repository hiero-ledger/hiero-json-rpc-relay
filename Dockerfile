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

# Compile monorepo packages.
RUN npm run build

# Write build-time env to .env.release — a path that is never overridden by
# user volume mounts. Stores npm_package_version required by ConfigService.
RUN printf 'npm_package_version=%s\n' \
        "$(node -p "require('./packages/server/package.json').version")" > .env.release

# Prune development dependencies and runtime artifacts.
RUN npm prune --omit=dev --ignore-scripts

# Remove source code, maps, and type definitions to reduce image footprint.
RUN find packages -mindepth 2 -maxdepth 2 -type d \
        \( -name src -o -name tests -o -name test \) \
        -exec rm -rf {} + ; \
    find packages -name '*.js.map' -delete ; \
    find packages -name '*.d.ts'   -delete

# Runtime Stage
# Minimal Alpine-based image containing only production artifacts.
# Node.js runs directly as PID 1 via --env-file, with no shell intermediary.
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

# Create an empty user env placeholder so Node does not error when no
# .env is volume-mounted at runtime (-v ./.env:/home/node/app/.env).
RUN touch /home/node/app/.env && chown node:node /home/node/app/.env

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
ENTRYPOINT ["node", "--env-file=/home/node/app/.env.release", "--env-file=/home/node/app/.env"]
CMD ["packages/server/dist/index.js"]

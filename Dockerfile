# syntax=docker/dockerfile:1

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /home/node/app

COPY package.json package-lock.json lerna.json ./
COPY packages/config-service/package.json packages/config-service/
COPY packages/relay/package.json           packages/relay/
COPY packages/server/package.json          packages/server/
COPY packages/ws-server/package.json       packages/ws-server/

# Install dependencies using npm ci for deterministic builds.
# --ignore-scripts blocks third-party lifecycle hooks (preinstall/postinstall),
# reducing any unintended side effects during installation.
RUN npm ci --ignore-scripts

# Copy source code and configurations for compilation.
COPY tsconfig.json ./
COPY packages/ packages/
COPY scripts/ scripts/

# Compile packages.
RUN npm run build

# Write build-time env to .env.release — a path that is never overridden by
# user volume mounts. Stores npm_package_version required by ConfigService.
RUN printf 'npm_package_version=%s\n' \
        "$(node -p "require('./package.json').version")" > .env.release

# Execute Node File Trace (NFT) analysis.
# This strictly traces all natively loaded packages, AST requirement graphs, and
# dynamic native libraries. It builds an optimized /.standalone runtime environment
# mirroring the exact structure of what is needed to load the server logic.
RUN node scripts/build-standalone.js

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV HEALTHCHECK_PORT=7546

WORKDIR /home/node/app

# npm, npx, corepack, and yarn are bundled with the base image but serve no purpose at runtime.
RUN rm -rf \
    /usr/local/lib/node_modules \
    /usr/local/bin/npm          \
    /usr/local/bin/npx          \
    /usr/local/bin/corepack     \
    /usr/local/bin/yarn         \
    /usr/local/bin/yarnpkg

# Safely copy only the standalone AST-traced dependencies & executed logic
COPY --from=build --chown=node:node /home/node/app/.standalone ./
COPY --chown=node:node              docs/openrpc.json          ./docs/openrpc.json

# Expose the ports used by the server and health check endpoints.
EXPOSE 7546
EXPOSE 8546
EXPOSE 8547

# Configure a health check to monitor the container's health status.
HEALTHCHECK --interval=10s --retries=3 --start-period=25s --timeout=2s \
    CMD wget -q -O- http://localhost:${HEALTHCHECK_PORT}/health/liveness

# Drop root privileges by switching to the node user for security in containerized applications.
USER node

# Node.js runs as PID 1, ensuring OS signals (SIGTERM, SIGINT) are delivered
# directly to the process for clean shutdown without a shell wrapper.
# .env.release is loaded first (build-time vars including npm_package_version);
ENTRYPOINT ["node", "--env-file=/home/node/app/.env.release"]
CMD ["packages/server/dist/index.js"]

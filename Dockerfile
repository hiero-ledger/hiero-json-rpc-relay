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
# --omit=dev/optional/--production flags are intentionally skipped here 
# as production pruning is handled by the build-standalone script.
RUN npm ci --ignore-scripts

# Copy source code and configurations for compilation.
COPY tsconfig.json ./
COPY packages/ packages/
COPY scripts/ scripts/

# Copy OpenRPC document for runtime access by /openrpc endpoint.
COPY docs/openrpc.json docs/

# Compile packages.
RUN npm run build

# Stores npm_package_version required by ConfigService.
RUN node -p "'npm_package_version=' + require('./package.json').version" > .env.release

# Post-build automatically trace using @vercel/nft to generate
# the most minimal standalone build with only required files at run time.
RUN node scripts/build-standalone.js

# ── Runtime ───────────────────────────────────────────────────────────────────
# Base image: node:22-alpine for a secure, minimal footprint and fast downloads.
FROM node:22-alpine AS runtime

# Standard security headers and runtime-only variables.
ENV NODE_ENV=production
ENV HEALTHCHECK_PORT=7546

WORKDIR /home/node/app

# Install tini so Node.js does not run as PID 1 (PID 1 ignores signals like SIGUSR2
# needed for on-demand heap snapshots via --heapsnapshot-signal).
RUN apk add --no-cache tini

# Remove unnecessary Node.js toolchains from the final runtime image.
RUN rm -rf \
    /usr/local/lib/node_modules \
    /usr/local/bin/npm          \
    /usr/local/bin/npx          \
    /usr/local/bin/corepack     \
    /usr/local/bin/yarn         \
    /usr/local/bin/yarnpkg

# Copy the dynamically minimal traced standalone bundle & the .env.release file from the build stage.
COPY --from=build --chown=node:node /home/node/app/.standalone   ./
COPY --from=build --chown=node:node /home/node/app/.env.release ./.env.release

# Ensure node user can write to WORKDIR (needed for heap snapshots written to CWD).
RUN chown node:node /home/node/app

# expose ports for the relay and WebSocket server.
EXPOSE 7546
EXPOSE 8546
EXPOSE 8547

# Drop root privileges by switching to the node user for security in containerized applications.
USER node

# Configure a health check to monitor the container's health status.
HEALTHCHECK --interval=10s --retries=3 --start-period=25s --timeout=2s \
    CMD wget -q -O- http://localhost:${HEALTHCHECK_PORT}/health/liveness || exit 1

# Use tini as PID 1 so Node.js receives signals properly (SIGTERM, SIGINT, SIGUSR2).
# Explicitly loads .env.release at startup.
ENTRYPOINT ["/sbin/tini", "--", "node", "--trace-gc", "--heapsnapshot-signal=SIGUSR2", "--env-file=/home/node/app/.env.release"]
CMD ["packages/server/dist/index.js"]

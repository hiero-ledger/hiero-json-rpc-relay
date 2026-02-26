############################
# Stage 1 — Build
############################
FROM node:22-bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

WORKDIR /home/node/app/

COPY package*.json ./
COPY lerna.json ./
COPY --chown=node:node ./packages ./packages

RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force --loglevel=error

RUN npm run build

############################
# Stage 2 — Prune
############################
FROM builder AS pruner

# Remove TypeScript source, source maps, declaration files, test artefacts,
# and pino-pretty (only needed when PRETTY_LOGS_ENABLED=true, disabled by default).
RUN find packages -type f \( \
        -name '*.ts' ! -name '*.d.ts' -o \
        -name '*.js.map' -o \
        -name '*.d.ts' -o \
        -name '*.d.ts.map' -o \
        -name '*.tsbuildinfo' \
    \) -delete && \
    find packages -type d -name tests -exec rm -rf {} + 2>/dev/null; \
    find packages -type d -name __tests__ -exec rm -rf {} + 2>/dev/null; \
    rm -rf node_modules/pino-pretty packages/*/node_modules/pino-pretty && \
    rm -rf node_modules/lodash packages/*/node_modules/lodash && \
    rm -rf node_modules/.cache

############################
# Stage 3 — Runtime
############################
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV HEALTHCHECK_PORT=7546

EXPOSE 7546
EXPOSE 8546
EXPOSE 8547

HEALTHCHECK --interval=10s --retries=3 --start-period=25s --timeout=2s CMD wget -q -O- http://localhost:${HEALTHCHECK_PORT}/health/liveness
WORKDIR /home/node/app/

# Copy only the pruned production artefacts from the build stage
COPY --from=pruner --chown=node:node /home/node/app/ ./

USER node
ENTRYPOINT ["node"]
CMD ["packages/server/dist/index.js"]

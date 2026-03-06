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

# Compile packages.
RUN npm run build

# Write build-time env to .env.release — a path that is never overridden by
# user volume mounts. Stores npm_package_version required by ConfigService.
RUN printf 'npm_package_version=%s\n' \
        "$(node -p "require('package.json').version")" > .env.release

# Post-build cleanup to minimize the runtime image size by removing unnecessary files and dependencies.
#
# 1. --omit=dev removes dev dependencies
#    --omit=optional removes optional dependencies
#
# 2. React-native subtree: @hiero-ledger/cryptography lists
#    react-native-get-random-values as a hard dependency, which is not used in a server context,
#    making the entire subtree dead weight in a server context. npm hoists react-native's direct
#    dependencies (metro bundler, hermes-compiler, …) to the top-level node_modules independently,
#    so each must be removed explicitly because deleting node_modules/react-native alone leaves the hoisted packages behind.
#
# 3. npm internals not read by Node.js at runtime:
#    .package-lock.json — npm v7 internal dependency tracker (710 KB)
#    .bin/              — 89 CLI symlinks; the server starts via a direct node
#                         invocation so no binary in .bin/ is ever executed
#    @napi-rs/          — guards against future lock-file drift re-introducing
#                         platform-specific native binaries; no-op when absent
#
# 4. Build artefacts shipped by packages but never loaded by require():
#    source maps, TypeScript source, ESM variants (monorepo targets CJS only),
#    documentation, licence files, metadata dotfiles (tsconfig, binding.gyp,
#    .eslintrc, .prettierrc, .babelrc, jest.config, .editorconfig), and
#    test/example directories.
RUN npm prune --omit=dev --omit=optional --ignore-scripts && \
    rm -rf \
        node_modules/react-native                   \
        node_modules/react-native-get-random-values \
        node_modules/hermes-compiler                \
        node_modules/@react-native                  \
        node_modules/react-devtools-core            \
        node_modules/fb-dotslash                    \
        node_modules/metro                          \
        node_modules/metro-babel-transformer        \
        node_modules/metro-cache                    \
        node_modules/metro-cache-key                \
        node_modules/metro-config                   \
        node_modules/metro-core                     \
        node_modules/metro-file-map                 \
        node_modules/metro-minify-terser            \
        node_modules/metro-resolver                 \
        node_modules/metro-runtime                  \
        node_modules/metro-source-map               \
        node_modules/metro-symbolicate              \
        node_modules/metro-transform-plugins        \
        node_modules/metro-transform-worker         \
        node_modules/ob1                            \
        node_modules/fast-base64-decode             \
        node_modules/jsc-safe-url                   \
        node_modules/.bin                           \
        node_modules/.package-lock.json             \
        node_modules/@napi-rs                       && \
    find packages -mindepth 2 -maxdepth 2 -type d \
            \( -name src -o -name tests -o -name test \) -exec rm -rf {} + && \
    find packages \( -name '*.js.map' -o -name '*.d.ts' \) -delete          && \
    find node_modules \( \
             -name '*.map'                                                    \
             -o -name '*.md'                                                  \
             -o -name 'LICENSE'      -o -name 'LICENSE.*' -o -name 'LICENSE-*' \
             -o -name 'LICENCE'      -o -name 'LICENCE.*'                    \
             -o -name 'CHANGELOG'    -o -name 'CHANGELOG.*'                  \
             -o -name 'CHANGES'      -o -name 'CHANGES.*'                    \
             -o -name 'HISTORY'      -o -name 'HISTORY.*'                    \
             -o -name 'AUTHORS'      -o -name 'AUTHORS.*'                    \
             -o -name 'CONTRIBUTORS' -o -name 'CONTRIBUTORS.*'               \
             -o -name 'NOTICE'       -o -name 'NOTICE.*'                     \
             -o -name '.npmignore'   -o -name '.gitattributes'               \
             -o -name '.travis.yml'  -o -name '.DS_Store'                    \
             -o -name 'Makefile'                                              \
             -o -name 'tsconfig.json' -o -name 'tsconfig.*.json'             \
             -o -name 'binding.gyp'                                          \
             -o -name '.eslintrc'    -o -name '.eslintrc.*'                  \
             -o -name '.prettierrc'  -o -name '.prettierrc.*'                \
             -o -name '.babelrc'     -o -name '.babelrc.*' -o -name 'babel.config.js' \
             -o -name 'jest.config.js' -o -name 'jest.config.ts' -o -name '.jestrc' \
             -o -name '.editorconfig'                                        \
         \) -delete                                                          && \
    find node_modules -name '*.ts' -not -name '*.d.ts' -delete              && \
    find node_modules -type d -name 'lib.esm' -prune -exec rm -rf {} +      && \
    find node_modules -type d \( \
             -name '__tests__'                          \
             -o -name 'test'      -o -name 'tests'      \
             -o -name 'spec'                            \
             -o -name 'benchmark' -o -name 'benchmarks' \
             -o -name 'example'   -o -name 'examples'   \
             -o -name 'docs'                            \
         \) -prune -exec rm -rf {} +

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

# Copy only the necessary files from the build stage
COPY --from=build --chown=node:node /home/node/app/node_modules ./node_modules
COPY --from=build --chown=node:node /home/node/app/packages     ./packages
COPY --from=build --chown=node:node /home/node/app/.env.release ./.env.release
COPY --chown=node:node              docs/openrpc.json           ./docs/openrpc.json

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

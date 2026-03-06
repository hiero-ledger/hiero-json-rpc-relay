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
# --omit=optional ensures any optional package that arrived via --include or
# reinstall is also removed, making the prune consistent with the install step.
RUN npm prune --omit=dev --omit=optional --ignore-scripts

# Remove the react-native transitive dependency tree (~130 MB).
#
# @hiero-ledger/cryptography declares react-native-get-random-values as a hard
# dependency; however, that package is only imported via the React Native
# entry-point (polyfills.native.cjs → index.native.cjs).  The Node.js CJS
# entry-point (lib/index.cjs) never loads it, so this entire subtree is dead
# weight in a server-side container.
#
# The metro bundler tree (~6.3 MB) is hoisted to the top-level node_modules by
# npm (it is a direct dependency of react-native itself).  Deleting
# node_modules/react-native does not remove hoisted entries, so each package
# must be listed explicitly.
RUN rm -rf \
    node_modules/react-native \
    node_modules/react-native-get-random-values \
    node_modules/hermes-compiler \
    node_modules/@react-native \
    node_modules/react-devtools-core \
    node_modules/fb-dotslash \
    node_modules/metro \
    node_modules/metro-babel-transformer \
    node_modules/metro-cache \
    node_modules/metro-cache-key \
    node_modules/metro-config \
    node_modules/metro-core \
    node_modules/metro-file-map \
    node_modules/metro-minify-terser \
    node_modules/metro-resolver \
    node_modules/metro-runtime \
    node_modules/metro-source-map \
    node_modules/metro-symbolicate \
    node_modules/metro-transform-plugins \
    node_modules/metro-transform-worker \
    node_modules/ob1 \
    node_modules/fast-base64-decode \
    node_modules/jsc-safe-url

# Remove npm-internal artefacts that are never read by Node.js at runtime.
# .bin/               — CLI symlinks for 89 production-dep binaries; we invoke
#                       node directly so none of these are ever executed.
# .package-lock.json  — npm v7 internal dependency-tree snapshot (710 KB); not
#                       loaded by the runtime, only used by npm CLI tooling.
# @napi-rs/           — safety-net: with --omit=optional this dir is not
#                       installed; the rm is a no-op but guards against any
#                       future lock-file drift that pulls in platform binaries.
RUN rm -rf \
    node_modules/.bin \
    node_modules/.package-lock.json \
    node_modules/@napi-rs

# Remove source code, maps, and type definitions to reduce image footprint.
RUN find packages -mindepth 2 -maxdepth 2 -type d \
        \( -name src -o -name tests -o -name test \) \
        -exec rm -rf {} + ; \
    find packages -name '*.js.map' -delete ; \
    find packages -name '*.d.ts'   -delete

# Strip non-runtime artefacts from production node_modules.
# *.map               — source maps (debugger-only; never loaded by Node.js)
# *.ts                — TypeScript source (compiled to *.js; *.d.ts excluded)
# lib.esm/            — ESM tree-shaking variants; monorepo targets CommonJS only
# Documentation       — *.md, LICENSE*, CHANGELOG*, HISTORY*, AUTHORS*, NOTICE*
# Package metadata    — .npmignore, .gitattributes, .travis.yml, .DS_Store, Makefile
# Build config files  — tsconfig*.json, binding.gyp, .eslintrc*, .prettierrc*,
#                       .babelrc*, babel.config.js, jest.config.*, .editorconfig
#                       These are never read by Node.js but are shipped by many
#                       packages alongside their compiled output.
# Test/example dirs   — __tests__/, test/, tests/, spec/, benchmark(s)/, example(s)/, docs/
RUN find node_modules \( \
         -name '*.map' \
         -o -name '*.md' \
         -o -name 'LICENSE' -o -name 'LICENSE.*' -o -name 'LICENSE-*' \
         -o -name 'LICENCE' -o -name 'LICENCE.*' \
         -o -name 'CHANGELOG' -o -name 'CHANGELOG.*' \
         -o -name 'CHANGES' -o -name 'CHANGES.*' \
         -o -name 'HISTORY' -o -name 'HISTORY.*' \
         -o -name 'AUTHORS' -o -name 'AUTHORS.*' \
         -o -name 'CONTRIBUTORS' -o -name 'CONTRIBUTORS.*' \
         -o -name 'NOTICE' -o -name 'NOTICE.*' \
         -o -name '.npmignore' -o -name '.gitattributes' \
         -o -name '.travis.yml' -o -name '.DS_Store' \
         -o -name 'Makefile' \
         -o -name 'tsconfig.json' -o -name 'tsconfig.*.json' \
         -o -name 'binding.gyp' \
         -o -name '.eslintrc' -o -name '.eslintrc.*' \
         -o -name '.prettierrc' -o -name '.prettierrc.*' \
         -o -name '.babelrc' -o -name '.babelrc.*' -o -name 'babel.config.js' \
         -o -name 'jest.config.js' -o -name 'jest.config.ts' -o -name '.jestrc' \
         -o -name '.editorconfig' \
    \) -delete && \
    find node_modules -name '*.ts' -not -name '*.d.ts' -delete && \
    find node_modules -type d -name 'lib.esm' -prune -exec rm -rf {} + && \
    find node_modules -type d \( \
         -name '__tests__' \
         -o -name 'test' -o -name 'tests' \
         -o -name 'spec' \
         -o -name 'benchmark' -o -name 'benchmarks' \
         -o -name 'example' -o -name 'examples' \
         -o -name 'docs' \
    \) -prune -exec rm -rf {} +

# Runtime Stage
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV HEALTHCHECK_PORT=7546

WORKDIR /home/node/app

# Remove npm and corepack: the runtime only invokes the node binary directly.
# Stripping these tools reduces the image attack surface and reclaims ~20 MB.
RUN rm -rf /usr/local/lib/node_modules \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg

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

# Docker Image Size Optimization for Hedera JSON-RPC Relay

- **Related Issue:** [GitHub Issue #4986](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4986)

## The Problem

Original Docker image size for the Hedera JSON-RPC Relay was measured at **~900MB**. Standard optimization efforts, including the use of `node:22-alpine` as a base image and implementing multi-stage builds, only reduced the size to **~700MB** (~22% reduction), which is still pretty fat.

**The Culprit: Dependency Bloat and Hoisting.**
The primary driver of the image size is the presence of heavy, unused dependencies within the final `node_modules` directory. Specifically, `@hashgraph/sdk` depends on `@hiero-ledger/cryptography`, which enforces `react-native-get-random-values` and the entire `react-native` ecosystem (including `metro` and `hermes-compiler`) as transitive dependencies.

While these libraries are required for mobile contexts, they are entirely unused by the JSON-RPC Relay's server-side environment. Furthermore, standard `npm install --omit=dev` or `npm prune` commands do not remove these packages because they are listed as core dependencies of sub-modules. This results in hundreds of megabytes of "dead weight" (e.g., source maps, documentation, uncompiled TypeScript) being physically included in the runtime image.

---

## Technical Options Explored

### Option A: Manual Blocklist / Cleanup Scripts

This approach involves maintaining a lengthy set of `rm -rf` and `find` commands within the Dockerfile to explicitly delete known unused directories and files after compilation.

**Manual Cleanup Implementation:**

```dockerfile
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
```

**Results:** This approach reduces the final image size to **~345MB** (~62% reduction from the original 900MB).

**Pros:**

- Executed via standard Unix utilities already present in the build environment.
- No new external dependencies introduced for the build process.

**Cons:**

- **Technical Debt:** The blocklist must be manually updated whenever new "fat" dependencies are introduced.
- **Fragility:** Manual pruning is error-prone and may inadvertently delete files required for runtime.
- **Non-Scalable:** Identifying and tracing unnecessary sub-dependencies across a growing monorepo graph is an unsustainable maintenance burden.

---

### Option B: Autonomous AST Tracing via `@vercel/nft` (Best so far)

This solution utilizes **Node File Trace** package by Vercel (`@vercel/nft`), an industry-standard library with over **4.5 million weekly downloads**. Used fundamentally by Vercel and Next.js, it creates minimal standalone distributions for production deployments.

`@vercel/nft` performs static analysis of the application's Abstract Syntax Tree (AST), starting from the entry point (`packages/server/dist/index.js`). It creates an explicit allowlist of files and symlinks physically traversed during execution, effectively ignoring all unused modules.

**Implementation Summary:**
A compact script (`scripts/build-standalone.js`) executes the trace and copies the required files to a `.standalone` directory, which is then copied to the final runtime stage.

**Implementation Example (a short ~30 lines script):**

```javascript
const { nodeFileTrace } = require('@vercel/nft');
const fs = require('fs');
const path = require('path');

async function buildStandalone() {
  const rootDir = process.cwd();
  // Trace from the entrypoint index.js and explicitly required dynamic modules
  const files = ['packages/server/dist/index.js', 'packages/ws-server/dist/index.js', require.resolve('pino-pretty')];

  const { fileList } = await nodeFileTrace(files, { base: rootDir });
  const standaloneDir = path.join(rootDir, '.standalone');

  for (const file of fileList) {
    // Copy the precise traced files and symlinks into the .standalone directory
    const src = path.join(rootDir, file);
    const dest = path.join(standaloneDir, file);
    // ... logic to create directories and copy files/symlinks
  }
}
buildStandalone();
```

**Dockerfile Impact:**

```diff
- [Detailed cleanup script shown in Option A]
+ RUN node scripts/build-standalone.js

# Runtime Phase
- COPY --from=build --chown=node:node /home/node/app/node_modules ./node_modules
- COPY --from=build --chown=node:node /home/node/app/packages     ./packages
+ COPY --from=build --chown=node:node /home/node/app/.standalone   ./
```

**Results:** This approach generates a final image size of **174MB** (~80% reduction from the original 900MB).

**Pros:**

- **Autonomous:** Automatically adapts to changes in the dependency graph without manual intervention.
- **Precision:** Identifies the minimum set of files required for runtime, ensuring the smallest possible footprint.
- **Future-Proof:** Prevents image bloat even as new dependencies are added to the project.

**Cons:**

- Requires maintenance of the `scripts/build-standalone.js` file (~30 lines of code) and the `@vercel/nft` build-time dependency.

---

### Option C: Single-File Bundlers (Abandoned Alternatives)

Some other tools that attempt to "compile" Node applications into single physical files, primarily **`@vercel/ncc`** and **`esbuild`**.

**How they operate:** They bundle thousands of files into a single `dist/index.js`, entirely negating the need for a `node_modules` folder.

**Why they failed for the Relay:**
The JSON-RPC Relay employs the `pino` logger, which heavily relies on asynchronous Node.js `worker_threads` and dynamic string-based module resolution to keep logging off the main HTTP thread. Bundlers aggressively strip away physical file hierarchy, causing `pino`'s isolated workers to hopelessly crash with `MODULE_NOT_FOUND` errors on boot. Forcing bundlers to cleanly resolve these dynamic paths introduces extreme configuration complexity and "hacky" ad-hoc patching, directly violating our engineering standards.

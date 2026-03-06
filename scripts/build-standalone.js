// SPDX-License-Identifier: Apache-2.0

const { nodeFileTrace } = require('@vercel/nft');
const fs = require('fs/promises');
const path = require('path');

/**
 * Executes a static analysis trace of the Node.js dependency graph starting
 * from the main server entrypoints. It resolves all physical files required
 * for the application to run (including native addons, wasm, and package.json files)
 * and copies them into an isolated `.standalone` directory.
 *
 * This implementation leverages Node File Trace (NFT)—the same engine powering
 * Vercel and Next.js standalone outputs—ensuring only strictly executed files
 * are bundled into the final production image.
 *
 * By using this AST-based approach, we eliminate the need for brittle manual
 * pruning of the node_modules directory, resulting in more secure
 * and reliable production images.
 */
async function buildStandalone() {
  const rootDir = path.resolve(__dirname, '..');
  const standaloneDir = path.join(rootDir, '.standalone');

  const entrypoints = [
    path.join(rootDir, 'packages/server/dist/index.js'),
    path.join(rootDir, 'packages/ws-server/dist/index.js'),
    // Pino dynamically requires pino-pretty via string configuration.
    // We explicitly include it to ensure the logger operates with full formatting at runtime.
    require.resolve('pino-pretty'),
  ];

  console.log(`[Standalone Build] Preparing isolated directory at ${standaloneDir}...`);
  await fs.rm(standaloneDir, { recursive: true, force: true });
  await fs.mkdir(standaloneDir, { recursive: true });

  console.log('[Standalone Build] Tracing AST dependencies (including native & wasm)...');
  const { fileList } = await nodeFileTrace(entrypoints, {
    base: rootDir,
    processDotenv: true,
  });

  const filesArray = Array.from(fileList);
  console.log(`[Standalone Build] Trace complete. Found ${filesArray.length} required files.`);

  // Mirror files to standalone directory using native fs.cp (available in Node 16.7+).
  // This replaces the need for extra dependencies and handles monorepo symlinks via dereference.
  console.log('[Standalone Build] Mirroring files to standalone directory...');
  for (const file of filesArray) {
    const src = path.join(rootDir, file);
    const dest = path.join(standaloneDir, file);

    await fs.mkdir(path.dirname(dest), { recursive: true });

    // dereference: true resolves symlinks to actual content.
    // recursive: true is required as some nft results might point to package directories.
    await fs.cp(src, dest, { dereference: true, force: true, recursive: true });
  }

  // Copy non-AST assets that are required at runtime but not statically discoverable.
  const staticAssets = ['.env.release', 'docs/openrpc.json'];
  for (const asset of staticAssets) {
    const src = path.join(rootDir, asset);
    const dest = path.join(standaloneDir, asset);

    try {
      await fs.cp(src, dest, { dereference: true, force: true, recursive: true });
    } catch {
      // Silence optional asset errors
    }
  }

  console.log('[Standalone Build] Isolated runtime environment ready.');
}

buildStandalone().catch((error) => {
  console.error('[Standalone Build] Fatal error during packaging:', error);
  process.exit(1);
});

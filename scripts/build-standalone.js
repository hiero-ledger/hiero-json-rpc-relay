/**
 * Utility script to trace the production dependencies of the JSON RPC relay server
 * and output them into a `standalone` directory for minimal Docker builds.
 * This completely isolates what the server requires to run vs dead-weight dependencies
 * reducing our docker image footprint.
 */
const { nodeFileTrace } = require('@vercel/nft');
const fs = require('fs');
const path = require('path');

async function buildStandalone() {
  const rootDir = process.cwd();
  // Trace from the entrypoint index.js and any explicitly required dynamic modules
  const files = ['packages/server/dist/index.js', 'packages/ws-server/dist/index.js', require.resolve('pino-pretty')];

  console.log('Tracing files...');
  const { fileList } = await nodeFileTrace(files, {
    base: rootDir,
  });

  console.log(`Traced ${fileList.size} dependencies. Generating standalone build...`);

  const standaloneDir = path.join(rootDir, '.standalone');

  for (const file of fileList) {
    const src = path.join(rootDir, file);
    const dest = path.join(standaloneDir, file);

    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const stat = fs.lstatSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
    } else if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(src);
      if (!fs.existsSync(dest)) {
        fs.symlinkSync(target, dest);
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  }
  console.log('Successfully generated standalone build directory.');
}

buildStandalone().catch((error) => {
  console.error('Failed to create standalone build:', error);
  process.exit(1);
});

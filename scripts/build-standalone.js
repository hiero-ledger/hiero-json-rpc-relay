// SPDX-License-Identifier: Apache-2.0

const { nodeFileTrace } = require('@vercel/nft');
const fs = require('fs');
const path = require('path');

/**
 * Traces and bundles production dependencies into a `.standalone` directory.
 * This minimizes the Docker image footprint by isolating only the required runtime files.
 */
async function buildStandalone() {
  // Define the root and destination directories, and the entry points for tracing
  const root = process.cwd();
  const dest = path.join(root, '.standalone');
  const entries = [
    'dist/index.js',
    // nft cannot trace dynamic pino transports; pino-pretty must be provided as a root entry to be bundled
    require.resolve('pino-pretty'),
  ];

  console.log('Generating standalone build...');
  // nft returns a Set of file paths that are required by the entry points on run time, including nested dependencies
  const { fileList } = await nodeFileTrace(entries, { base: root });

  // Copy each traced file to the .standalone directory, preserving the directory structure
  // Using sequential execution to ensure directory creation before file copy
  for (const file of fileList) {
    const src = path.join(root, file);
    const target = path.join(dest, file);

    // Skip duplicates or files that might have been removed during trace (safety check)
    if (fs.existsSync(target) || !fs.existsSync(src)) continue;

    // Create directory and copy file/link with link preservation
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const s = fs.lstatSync(src);
    s.isSymbolicLink() ? fs.symlinkSync(fs.readlinkSync(src), target) : fs.copyFileSync(src, target);

    // Minimize package.json to essential runtime-only fields
    if (file.endsWith('package.json')) {
      const pkg = JSON.parse(fs.readFileSync(target, 'utf-8'));
      const min = {};
      ['name', 'version', 'main', 'type', 'exports', 'imports', 'dependencies'].forEach(
        (k) => pkg[k] && (min[k] = pkg[k]),
      );
      fs.writeFileSync(target, JSON.stringify(min, null, 2));
    }
  }
  console.log(`Build complete: ${fileList.size} files isolated in .standalone.`);
}

buildStandalone().catch((e) => (console.error(e), process.exit(1)));

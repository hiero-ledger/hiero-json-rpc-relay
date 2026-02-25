const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function build() {
  const entryPoints = ['packages/server/src/index.ts', 'packages/ws-server/src/index.ts'];

  console.log('Building bundles...');

  for (const entryPoint of entryPoints) {
    if (!fs.existsSync(entryPoint)) {
      console.warn(`Skipping missing entry point: ${entryPoint}`);
      continue;
    }

    const pathParts = entryPoint.split('/');
    const outName = pathParts[1]; // 'server' or 'ws-server'
    const outfile = `dist-bundle/${outName}.js`;

    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      target: 'node22',
      outfile: outfile,
      minify: true,
      sourcemap: true,
      // Externals that should not be bundled
      external: [
        'isolated-vm', // Native module - must be installed in production image
      ],
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      logLevel: 'info',
    });

    console.log(`Successfully bundled ${entryPoint} -> ${outfile}`);
  }
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

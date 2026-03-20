// SPDX-License-Identifier: Apache-2.0

const { nodeFileTrace } = require('@vercel/nft');
const fs = require('fs');
const path = require('path');

const HASHGRAPH_SDK_RUNTIME_MODULES = [
  'lib/account/AccountId.cjs',
  'lib/client/NodeClient.cjs',
  'lib/EthereumTransaction.cjs',
  'lib/EthereumTransactionData.cjs',
  // EthereumTransactionData variants required eagerly for SDK Cache initialization side effects.
  'lib/EthereumTransactionDataLegacy.cjs',
  'lib/EthereumTransactionDataEip1559.cjs',
  'lib/EthereumTransactionDataEip2930.cjs',
  'lib/EthereumTransactionDataEip7702.cjs',
  // Key._fromProtobufKey() dispatches through Cache for these converters.
  'lib/contract/ContractId.cjs',
  'lib/contract/DelegateContractId.cjs',
  'lib/KeyList.cjs',
  'lib/ExchangeRate.cjs',
  'lib/file/FileAppendTransaction.cjs',
  'lib/file/FileCreateTransaction.cjs',
  'lib/file/FileDeleteTransaction.cjs',
  'lib/file/FileId.cjs',
  'lib/file/FileInfoQuery.cjs',
  'lib/Hbar.cjs',
  'lib/HbarUnit.cjs',
  'lib/logger/Logger.cjs',
  'lib/logger/LogLevel.cjs',
  'lib/PrivateKey.cjs',
  'lib/PublicKey.cjs',
  'lib/query/Query.cjs',
  'lib/Status.cjs',
  'lib/transaction/Transaction.cjs',
  'lib/transaction/TransactionRecord.cjs',
  'lib/transaction/TransactionRecordQuery.cjs',
  'lib/transaction/TransactionResponse.cjs',
];

function resolveHashgraphSdkRuntimeEntries(root) {
  const sdkRoot = path.dirname(require.resolve('@hashgraph/sdk/package.json'));

  return HASHGRAPH_SDK_RUNTIME_MODULES.map((modulePath) => path.relative(root, path.join(sdkRoot, modulePath)));
}

/**
 * Traces and bundles production dependencies into a `.standalone` directory.
 * This minimizes the Docker image footprint by isolating only the required runtime files.
 */
async function buildStandalone() {
  // Define the root and destination directories, and the entry points for tracing
  const root = process.cwd();
  const dest = path.join(root, '.standalone');
  const entries = [
    'packages/server/dist/index.js',
    'packages/ws-server/dist/index.js',
    // nft cannot trace dynamic pino transports; pino-pretty must be provided as a root entry to be bundled
    require.resolve('pino-pretty'),
    // The relay's selective SDK wrapper loads these modules via computed absolute paths.
    // Seed nft with the concrete files so the standalone image retains them and their transitive dependencies.
    ...resolveHashgraphSdkRuntimeEntries(root),
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

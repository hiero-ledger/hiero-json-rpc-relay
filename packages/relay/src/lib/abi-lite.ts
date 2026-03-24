// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

/**
 * Lightweight @ethersproject/abi require-cache override.
 *
 * The Hedera SDK's ContractFunctionResult.cjs imports the @ethersproject/abi
 * barrel (index.js), which pulls in interface.js → @ethersproject/hash →
 * ens-normalize/lib.js. The ENS normalization module allocates a 5 MB+ Unicode
 * validation Set and supporting data structures at module scope. The relay never
 * resolves ENS names, so this memory is entirely wasted.
 *
 * The SDK only uses defaultAbiCoder.encode/decode (from abi-coder.js) and
 * ParamType (from fragments.js). This module pre-seeds Node's require.cache
 * with a synthetic @ethersproject/abi entry whose exports are all lazy. When
 * the SDK first accesses defaultAbiCoder, only fragments.js and abi-coder.js
 * load — interface.js (and the ENS chain) never loads unless explicitly accessed.
 *
 * All exports are deferred so this module adds zero memory at startup. The
 * savings come entirely from never loading the ENS normalization tables.
 *
 * Import this module before any @hashgraph/sdk usage to ensure the cache entry
 * is in place before the SDK's require("@ethersproject/abi") resolves.
 */

const path = require('path');
const Module = require('module');

const abiEntryPath: string = require.resolve('@ethersproject/abi');
const abiDir: string = path.dirname(abiEntryPath);

// All exports are lazy — nothing loads until first access
const syntheticExports: Record<string, unknown> = { __esModule: true };

// fragments.js and abi-coder.js — deferred until first access
let fragmentsModule: Record<string, unknown> | null = null;
function getFragmentsModule(): Record<string, unknown> {
  if (!fragmentsModule) {
    fragmentsModule = require(path.join(abiDir, 'fragments')) as Record<string, unknown>;
  }
  return fragmentsModule;
}

let abiCoderModule: Record<string, unknown> | null = null;
function getAbiCoderModule(): Record<string, unknown> {
  if (!abiCoderModule) {
    abiCoderModule = require(path.join(abiDir, 'abi-coder')) as Record<string, unknown>;
  }
  return abiCoderModule;
}

for (const name of [
  'ConstructorFragment',
  'ErrorFragment',
  'EventFragment',
  'FormatTypes',
  'Fragment',
  'FunctionFragment',
  'ParamType',
]) {
  Object.defineProperty(syntheticExports, name, {
    enumerable: true,
    get: () => getFragmentsModule()[name],
  });
}

for (const name of ['AbiCoder', 'defaultAbiCoder']) {
  Object.defineProperty(syntheticExports, name, {
    enumerable: true,
    get: () => getAbiCoderModule()[name],
  });
}

// interface.js exports — deferred so the ENS dependency chain
// (interface.js → @ethersproject/hash → ens-normalize) never loads
// during normal relay operation. The Hedera SDK never accesses these.
let interfaceModule: Record<string, unknown> | null = null;
function getInterfaceModule(): Record<string, unknown> {
  if (!interfaceModule) {
    interfaceModule = require(path.join(abiDir, 'interface')) as Record<string, unknown>;
  }
  return interfaceModule;
}

for (const name of ['checkResultErrors', 'Indexed', 'Interface', 'LogDescription', 'TransactionDescription']) {
  Object.defineProperty(syntheticExports, name, {
    enumerable: true,
    get: () => getInterfaceModule()[name],
  });
}

// Install the synthetic module into require.cache so all subsequent
// require("@ethersproject/abi") calls receive the lightweight version.
const syntheticModule = new Module(abiEntryPath);
syntheticModule.id = abiEntryPath;
syntheticModule.filename = abiEntryPath;
syntheticModule.loaded = true;
syntheticModule.exports = syntheticExports;
require.cache[abiEntryPath] = syntheticModule;

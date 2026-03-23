// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, no-redeclare */

/**
 * Selective re-exports from the Hedera JavaScript SDK.
 *
 * The relay uses a small subset of SDK classes, but importing from the package
 * root eagerly loads the SDK's monolithic CommonJS barrel and a large dependency
 * graph. This module exposes only the runtime symbols used by relay production
 * code and resolves each symbol lazily on first access.
 *
 * Runtime resolution relies on absolute paths into the SDK's current internal
 * CommonJS layout because the package only exports the root entry point. Type
 * imports continue to use the public package surface where available so the
 * wrapper remains strongly typed and straightforward to replace if the SDK adds
 * public subpath exports in a future release.
 */

import type {
  AccountId as _AccountId,
  Client as _Client,
  EthereumTransaction as _EthereumTransaction,
  EthereumTransactionData as _EthereumTransactionData,
  ExchangeRate as _ExchangeRate,
  FileAppendTransaction as _FileAppendTransaction,
  FileCreateTransaction as _FileCreateTransaction,
  FileDeleteTransaction as _FileDeleteTransaction,
  FileId as _FileId,
  FileInfoQuery as _FileInfoQuery,
  Hbar as _Hbar,
  HbarUnit as _HbarUnit,
  Logger as _Logger,
  LogLevel as _LogLevel,
  PrivateKey as _PrivateKey,
  PublicKey as _PublicKey,
  Query as _Query,
  Status as _Status,
  Transaction as _Transaction,
  TransactionRecord as _TransactionRecord,
  TransactionRecordQuery as _TransactionRecordQuery,
  TransactionResponse as _TransactionResponse,
} from '@hashgraph/sdk';
import type { Operator as _Operator } from '@hashgraph/sdk/lib/client/Client';
import type { BigNumber as _BigNumber } from '@hashgraph/sdk/lib/Transfer';

const path = require('path');

// ---------------------------------------------------------------------------
// Pre-seed require.cache for @ethersproject/abi to prevent ENS table loading
// ---------------------------------------------------------------------------
//
// The SDK's ContractFunctionResult.cjs requires the @ethersproject/abi barrel
// (index.js), which imports interface.js → @ethersproject/hash → namehash.js
// → ens-normalize/lib.js. That module builds a 5 MB+ Unicode validation Set
// and supporting structures at module scope — memory the relay never uses
// because it never resolves ENS names.
//
// The SDK only calls defaultAbiCoder.decode() and defaultAbiCoder.encode()
// (from abi-coder.js) and references ParamType (from fragments.js). By
// constructing a replacement module that loads only those two submodules and
// defers Interface/Indexed/LogDescription/TransactionDescription/checkResultErrors
// to a lazy getter (loaded only if actually accessed), the ENS normalization
// tables are never evaluated during normal relay operation.
//
// This cache entry must be installed before any SDK module triggers
// require("@ethersproject/abi").
// ---------------------------------------------------------------------------
(function installLightweightAbiModule() {
  const abiEntryPath = require.resolve('@ethersproject/abi');
  const abiDir = path.dirname(abiEntryPath);

  // Load only the safe submodules (fragments + abi-coder) — no ENS dependency chain
  const fragments = require(path.join(abiDir, 'fragments'));
  const abiCoder = require(path.join(abiDir, 'abi-coder'));

  // Build a replacement exports object with the same shape as the original index.js
  const syntheticExports: Record<string, unknown> = {
    __esModule: true,

    // fragments.js exports — always loaded (lightweight)
    ConstructorFragment: fragments.ConstructorFragment,
    ErrorFragment: fragments.ErrorFragment,
    EventFragment: fragments.EventFragment,
    FormatTypes: fragments.FormatTypes,
    Fragment: fragments.Fragment,
    FunctionFragment: fragments.FunctionFragment,
    ParamType: fragments.ParamType,

    // abi-coder.js exports — always loaded (lightweight)
    AbiCoder: abiCoder.AbiCoder,
    defaultAbiCoder: abiCoder.defaultAbiCoder,
  };

  // interface.js exports — deferred behind lazy getters so the ENS dependency
  // chain (interface.js → @ethersproject/hash → ens-normalize) only loads if
  // code actually accesses Interface, Indexed, etc. The SDK never does.
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

  // Replace the cached module entry so all subsequent require("@ethersproject/abi")
  // calls receive the lightweight version without triggering the original index.js.
  const Module = require('module') as typeof import('module');
  const syntheticModule = new Module(abiEntryPath);
  syntheticModule.id = abiEntryPath;
  syntheticModule.filename = abiEntryPath;
  syntheticModule.loaded = true;
  syntheticModule.exports = syntheticExports;
  require.cache[abiEntryPath] = syntheticModule;
})();

const exportTarget = exports as Record<string, unknown>;
const sdkLibPath = path.join(path.dirname(require.resolve('@hashgraph/sdk/package.json')), 'lib');

/**
 * Resolves the absolute path to an internal SDK CommonJS module.
 *
 * @param relativeModulePath - SDK-relative path beneath the package lib directory.
 * @returns Absolute filesystem path to the requested CommonJS module.
 */
function resolveSdkModulePath(relativeModulePath: string): string {
  return path.join(sdkLibPath, relativeModulePath);
}

/**
 * Loads the default export from an internal SDK CommonJS module.
 *
 * Node.js caches required modules, so repeated accesses reuse the same loaded
 * implementation after the first resolution.
 *
 * @typeParam T - Runtime type of the module default export.
 * @param relativeModulePath - SDK-relative path beneath the package lib directory.
 * @returns The module's default export.
 */
function loadSdkDefaultExport<T>(relativeModulePath: string): T {
  const moduleExports = require(resolveSdkModulePath(relativeModulePath)) as { default: T };
  return moduleExports.default;
}

/**
 * Defines a lazily-evaluated named export backed by an internal SDK default export.
 *
 * @typeParam T - Runtime type exposed by the named export.
 * @param exportName - Name exposed from this wrapper module.
 * @param relativeModulePath - SDK-relative path beneath the package lib directory.
 */
function defineLazySdkDefaultExport<T>(exportName: string, relativeModulePath: string): void {
  Object.defineProperty(exportTarget, exportName, {
    enumerable: true,
    get: () => loadSdkDefaultExport<T>(relativeModulePath),
  });
}

export type AccountId = _AccountId;
export declare const AccountId: typeof _AccountId;

export type Client = _Client;
export declare const Client: typeof _Client;

export type EthereumTransaction = _EthereumTransaction;
export declare const EthereumTransaction: typeof _EthereumTransaction;

export type EthereumTransactionData = _EthereumTransactionData;
export declare const EthereumTransactionData: typeof _EthereumTransactionData;

export type ExchangeRate = _ExchangeRate;
export declare const ExchangeRate: typeof _ExchangeRate;

export type FileAppendTransaction = _FileAppendTransaction;
export declare const FileAppendTransaction: typeof _FileAppendTransaction;

export type FileCreateTransaction = _FileCreateTransaction;
export declare const FileCreateTransaction: typeof _FileCreateTransaction;

export type FileDeleteTransaction = _FileDeleteTransaction;
export declare const FileDeleteTransaction: typeof _FileDeleteTransaction;

export type FileId = _FileId;
export declare const FileId: typeof _FileId;

export type FileInfoQuery = _FileInfoQuery;
export declare const FileInfoQuery: typeof _FileInfoQuery;

export type Hbar = _Hbar;
export declare const Hbar: typeof _Hbar;

export type HbarUnit = _HbarUnit;
export declare const HbarUnit: typeof _HbarUnit;

export type Logger = _Logger;
export declare const Logger: typeof _Logger;

export type LogLevel = _LogLevel;
export declare const LogLevel: typeof _LogLevel;

export type PrivateKey = _PrivateKey;
export declare const PrivateKey: typeof _PrivateKey;

export type PublicKey = _PublicKey;
export declare const PublicKey: typeof _PublicKey;

export type Query<OutputT = unknown> = _Query<OutputT>;
export declare const Query: typeof _Query;

export type Status = _Status;
export declare const Status: typeof _Status;

export type Transaction = _Transaction;
export declare const Transaction: typeof _Transaction;

export type TransactionRecord = _TransactionRecord;
export declare const TransactionRecord: typeof _TransactionRecord;

export type TransactionRecordQuery = _TransactionRecordQuery;
export declare const TransactionRecordQuery: typeof _TransactionRecordQuery;

export type TransactionResponse = _TransactionResponse;
export declare const TransactionResponse: typeof _TransactionResponse;

export type BigNumber = _BigNumber;
export type Operator = _Operator;

defineLazySdkDefaultExport<typeof _AccountId>('AccountId', 'account/AccountId.cjs');
defineLazySdkDefaultExport<typeof _Client>('Client', 'client/NodeClient.cjs');
defineLazySdkDefaultExport<typeof _EthereumTransaction>('EthereumTransaction', 'EthereumTransaction.cjs');
defineLazySdkDefaultExport<typeof _EthereumTransactionData>('EthereumTransactionData', 'EthereumTransactionData.cjs');

// EthereumTransactionData.fromBytes() dispatches through the SDK's internal Cache singleton.
// Each variant module registers its converter as a module-level side effect. Eagerly loading
// them here ensures the Cache is populated before any relay code calls fromBytes().
require(resolveSdkModulePath('EthereumTransactionDataLegacy.cjs'));
require(resolveSdkModulePath('EthereumTransactionDataEip1559.cjs'));
require(resolveSdkModulePath('EthereumTransactionDataEip2930.cjs'));
require(resolveSdkModulePath('EthereumTransactionDataEip7702.cjs'));

// Key._fromProtobufKey() dispatches through Cache for ContractId, DelegateContractId,
// and KeyList conversions. These modules are not directly imported by the relay but are
// reached when deserializing TransactionRecord responses that contain key/alias fields.
require(resolveSdkModulePath('contract/ContractId.cjs'));
require(resolveSdkModulePath('contract/DelegateContractId.cjs'));
require(resolveSdkModulePath('KeyList.cjs'));

defineLazySdkDefaultExport<typeof _ExchangeRate>('ExchangeRate', 'ExchangeRate.cjs');
defineLazySdkDefaultExport<typeof _FileAppendTransaction>('FileAppendTransaction', 'file/FileAppendTransaction.cjs');
defineLazySdkDefaultExport<typeof _FileCreateTransaction>('FileCreateTransaction', 'file/FileCreateTransaction.cjs');
defineLazySdkDefaultExport<typeof _FileDeleteTransaction>('FileDeleteTransaction', 'file/FileDeleteTransaction.cjs');
defineLazySdkDefaultExport<typeof _FileId>('FileId', 'file/FileId.cjs');
defineLazySdkDefaultExport<typeof _FileInfoQuery>('FileInfoQuery', 'file/FileInfoQuery.cjs');
defineLazySdkDefaultExport<typeof _Hbar>('Hbar', 'Hbar.cjs');
defineLazySdkDefaultExport<typeof _HbarUnit>('HbarUnit', 'HbarUnit.cjs');
defineLazySdkDefaultExport<typeof _Logger>('Logger', 'logger/Logger.cjs');
defineLazySdkDefaultExport<typeof _LogLevel>('LogLevel', 'logger/LogLevel.cjs');
defineLazySdkDefaultExport<typeof _PrivateKey>('PrivateKey', 'PrivateKey.cjs');
defineLazySdkDefaultExport<typeof _PublicKey>('PublicKey', 'PublicKey.cjs');
defineLazySdkDefaultExport<typeof _Query>('Query', 'query/Query.cjs');
defineLazySdkDefaultExport<typeof _Status>('Status', 'Status.cjs');
defineLazySdkDefaultExport<typeof _Transaction>('Transaction', 'transaction/Transaction.cjs');
defineLazySdkDefaultExport<typeof _TransactionRecord>('TransactionRecord', 'transaction/TransactionRecord.cjs');
defineLazySdkDefaultExport<typeof _TransactionRecordQuery>(
  'TransactionRecordQuery',
  'transaction/TransactionRecordQuery.cjs',
);
defineLazySdkDefaultExport<typeof _TransactionResponse>('TransactionResponse', 'transaction/TransactionResponse.cjs');

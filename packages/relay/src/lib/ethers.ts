// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/no-require-imports, no-redeclare */

/**
 * Selective re-exports from ethers v6 submodules.
 *
 * The relay uses a small subset of ethers functionality. Importing from the top-level
 * 'ethers' package in CommonJS loads the entire package, including ENS normalization
 * tables (~6 MB) and BIP39 wordlists (~5 MB) that the relay does not use.
 *
 * This module imports only from the specific ethers submodules needed, avoiding
 * those heavy dependencies. All relay production code should import from this module
 * instead of directly from 'ethers'.
 *
 * require() is used because ethers v6 subpath exports (e.g., 'ethers/transaction')
 * cannot be resolved by TypeScript's 'node' moduleResolution. The subpaths resolve
 * correctly at runtime via Node.js package.json "exports" field.
 *
 * ESLint no-require-imports is disabled because ES import cannot resolve these subpaths
 * under the current TypeScript configuration. no-redeclare is disabled because TypeScript
 * intentionally supports exporting a type and value with the same name (declaration merging).
 */

import type {
  AuthorizationLike as _AuthorizationLike,
  keccak256 as _keccak256,
  Signature as _Signature,
  Transaction as _Transaction,
} from 'ethers';

// Re-export types for use in type annotations
export type Transaction = _Transaction;
export type Signature = _Signature;
export type AuthorizationLike = _AuthorizationLike;

// Runtime imports from submodules (avoids loading the full ethers package)
const ethersTransaction = require('ethers/transaction');
const ethersCrypto = require('ethers/crypto');

// Re-export runtime values with proper typing
export const Transaction: typeof _Transaction = ethersTransaction.Transaction;
export const Signature: typeof _Signature = ethersCrypto.Signature;
export const keccak256: typeof _keccak256 = ethersCrypto.keccak256;

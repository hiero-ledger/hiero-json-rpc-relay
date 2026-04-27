// SPDX-License-Identifier: Apache-2.0

/**
 * TypeScript declarations for ethers v6 subpath exports.
 *
 * ethers v6 exposes individual submodules via its package.json `"exports"` field
 * (e.g. `ethers/transaction`, `ethers/crypto`). Importing a subpath loads only that
 * submodule at runtime instead of the entire ethers barrel, significantly reducing
 * the memory footprint by omitting heavy modules and data tables not required by
 * the relay.
 *
 * This file acts as a "bridge" between the TypeScript compiler and Node.js.
 * Under the current `moduleResolution: "node"` setting, TypeScript doesn't know
 * how to find these subpaths. These declarations tell the compiler that these
 * modules exist and what types they contain, while allowing Node.js to resolve
 * them correctly at runtime.
 *
 * Only add declarations here for subpaths and exports actually used by this package.
 */

declare module 'ethers/transaction' {
  export type { AuthorizationLike } from 'ethers';
  export { Transaction } from 'ethers';
}

declare module 'ethers/crypto' {
  export { keccak256, Signature } from 'ethers';
}

// SPDX-License-Identifier: Apache-2.0

export const SKIPPED_KEYS = ['examples', 'baseFeePerBlobGas', 'blobGasUsedRatio'];

// Centralized categories for skipped methods
export const SKIP_CATEGORIES = {
  NOT_SUPPORTED: 'not supported',
  NOT_YET_IMPLEMENTED: 'not yet implemented',
  FORK_NOT_YET_IMPLEMENTED: 'fork or api not yet implemented',
  OVERWRITTEN: 'overwritten',
};

export const OVERWRITTEN_SKIP_FIELDS = [
  'eth_getBalance.params.1.required', // optional in Hedera, required in JSON-RPC
  'eth_getCode.params.1.required', // optional in Hedera, required in JSON-RPC
  'eth_gasPrice.summary', // wei was renamed to weibar in Hedera
  'eth_getLogs.summary', // even though the response interface is the same in Hedera and JSON-RPC the Hedera description is more accurate...
  'eth_newBlockFilter.summary', // even though the response interface is the same in Hedera and JSON-RPC the Hedera description is more accurate...
  'eth_getStorageAt.summary',
  'eth_getStorageAt.params.2.required', // optional in Hedera, required in JSON-RPC
  'eth_getTransactionCount.params.1.required', // optional in Hedera, required in JSON-RPC
  'eth_maxPriorityFeePerGas.summary', // we give more context
  'eth_getFilterChanges.summary',
  'eth_feeHistory.summary',
  'eth_syncing.summary',
  'eth_feeHistory.description',
  'eth_feeHistory.params.2.description',
  'eth_feeHistory.result.schema.properties.gasUsedRatio.description',
  'eth_feeHistory.result.schema.properties.baseFeePerGas.title',
  'eth_feeHistory.result.schema.properties.baseFeePerGas.description',
  'eth_feeHistory.result.schema.properties.reward.title',
  'eth_getTransactionCount.summary',
  'eth_maxPriorityFeePerGas.result.schema.description',
  'eth_sendRawTransaction.summary',
  'debug_getBadBlocks.summary', // included information that bad blocks are always empty in Hedera
];

// Methods that we will not support. Skip always. We already have a documentation for them stating that they are unimplemented.
export const NOT_SUPPORTED_SKIP_LIST = [
  'eth_coinbase',
  'eth_blobBaseFee',
  'eth_getProof',
  'eth_createAccessList',
  'eth_sendTransaction',
  'eth_sign',
  'eth_signTransaction',
  'eth_newPendingTransactionFilter',
  'eth_simulateV1',
];

export const NOT_YET_IMPLEMENTED_SKIP_LIST = [
];

// Methods that we will support, but we do not yet, because the fork or API is not yet supported. Skip always.
export const FORK_NOT_YET_IMPLEMENTED_SKIP_LIST = [
  'engine_*',
];

export const SKIPPED_METHODS = [
  ...NOT_SUPPORTED_SKIP_LIST,
  ...NOT_YET_IMPLEMENTED_SKIP_LIST,
  ...FORK_NOT_YET_IMPLEMENTED_SKIP_LIST,
];

export function shouldSkipMethod(methodName, path) {
  if (!methodName) return false;

  if (path) {
    const fullPath = `${methodName}.${path}`;
    if (OVERWRITTEN_SKIP_FIELDS.includes(fullPath)) return true;
  }

  for (const pattern of SKIPPED_METHODS) {
    if (pattern === methodName) return true;

    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (methodName.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function shouldSkipKey(key) {
  if (!key) return false;
  for (const pattern of SKIPPED_KEYS) {
    if (pattern === key) return true;
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (key.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function shouldSkipPath(path) {
  if (!path) return false;
  const parts = path.split('.');
  for (const part of parts) {
    if (shouldSkipKey(part)) return true;
  }
  return false;
}

export function getSkippedMethodCategory(methodName) {
  if (!methodName) return null;

  const matchesPattern = (pattern, method) => {
    if (pattern === method) return true;

    if (typeof pattern === 'string' && pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return method.startsWith(prefix);
    }

    return false;
  };

  if (NOT_SUPPORTED_SKIP_LIST.some((pattern) => matchesPattern(pattern, methodName))) {
    return SKIP_CATEGORIES.NOT_SUPPORTED;
  }

  if (NOT_YET_IMPLEMENTED_SKIP_LIST.some((pattern) => matchesPattern(pattern, methodName))) {
    return SKIP_CATEGORIES.NOT_YET_IMPLEMENTED;
  }

  if (FORK_NOT_YET_IMPLEMENTED_SKIP_LIST.some((pattern) => matchesPattern(pattern, methodName))) {
    return SKIP_CATEGORIES.FORK_NOT_YET_IMPLEMENTED;
  }

  if (OVERWRITTEN_SKIP_FIELDS.map((field) => field.split('.')[0]).some((pattern) => matchesPattern(pattern, methodName))) {
    return SKIP_CATEGORIES.OVERWRITTEN;
  }

  return null;
}

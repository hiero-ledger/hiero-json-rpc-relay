// SPDX-License-Identifier: Apache-2.0

export const SKIPPED_KEYS = ['examples', 'baseFeePerBlobGas', 'blobGasUsedRatio'];

export const OVERWRITTEN_SKIP_FIELDS = [
  'eth_feeHistory.summary',
  'eth_feeHistory.description',
  'eth_feeHistory.params.2.description',
  'eth_feeHistory.result.schema.properties.gasUsedRatio.description',
  'eth_feeHistory.result.schema.properties.baseFeePerGas.title',
  'eth_feeHistory.result.schema.properties.baseFeePerGas.description',
  'eth_feeHistory.result.schema.properties.reward.title',
  'eth_getTransactionCount.summary',
  'eth_maxPriorityFeePerGas.result.schema.description',
  'eth_sendRawTransaction.summary',
];

// Methods that we will not support. Skip always.
export const NON_SUPPORTED_SKIP_LIST = [
  'engine_*',
  'eth_coinbase',
  'eth_blobBaseFee',
  'eth_syncing',
  'eth_getProof',
  'eth_createAccessList',
  'eth_sendTransaction',
  'eth_sign',
  'eth_signTransaction',
];

// Methods that we will support, but we do not yet, due to prioritization. Skip always.
export const NOT_YET_SUPPORTED_SKIP_LIST = [
  'debug_getRawHeader',
  'debug_getRawReceipts',
  'debug_getRawTransaction',
];

// Methods that we will support, but we do not yet, because the fork is not yet supported. Skip always.
export const FORK_NOT_YET_SUPPORTED_SKIP_LIST = [
];

export const SKIPPED_METHODS = [
  ...NON_SUPPORTED_SKIP_LIST,
  ...NOT_YET_SUPPORTED_SKIP_LIST,
  ...FORK_NOT_YET_SUPPORTED_SKIP_LIST,
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

  if (NON_SUPPORTED_SKIP_LIST.some((pattern) => matchesPattern(pattern, methodName))) {
    return 'non supported';
  }

  if (NOT_YET_SUPPORTED_SKIP_LIST.some((pattern) => matchesPattern(pattern, methodName))) {
    return 'not yet supported';
  }

  if (FORK_NOT_YET_SUPPORTED_SKIP_LIST.some((pattern) => matchesPattern(pattern, methodName))) {
    return 'fork not yet supported';
  }

  if (OVERWRITTEN_SKIP_FIELDS.map((field) => field.split('.')[0]).some((pattern) => matchesPattern(pattern, methodName))) {
    return 'overwritten';
  }

  return null;
}

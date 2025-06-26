// SPDX-License-Identifier: Apache-2.0

export const SKIPPED_KEYS = ['examples', 'baseFeePerBlobGas', 'blobGasUsedRatio'];

export const CUSTOM_FIELDS = [
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

export const DISCARDED_METHODS = ['engine_*'];

export const NOT_IMPLEMENTED_METHODS = [
  'debug_getBadBlocks',
  'debug_getRawBlock',
  'debug_getRawHeader',
  'debug_getRawReceipts',
  'debug_getRawTransaction',
  'eth_coinbase',
  'eth_blobBaseFee',
  'eth_syncing',
  'eth_getProof',
];

export const SKIPPED_METHODS = [...DISCARDED_METHODS, ...NOT_IMPLEMENTED_METHODS];

export function shouldSkipMethod(methodName, path) {
  if (!methodName) return false;

  if (path) {
    const fullPath = `${methodName}.${path}`;
    if (CUSTOM_FIELDS.includes(fullPath)) return true;
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

    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return method.startsWith(prefix);
    }

    return false;
  };

  if (DISCARDED_METHODS.some((pattern) => matchesPattern(pattern, methodName))) {
    return 'discarded';
  }

  if (NOT_IMPLEMENTED_METHODS.some((pattern) => matchesPattern(pattern, methodName))) {
    return 'not implemented';
  }

  return null;
}

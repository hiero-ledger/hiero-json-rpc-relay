// SPDX-License-Identifier: Apache-2.0

import diff from 'deep-diff';

export function prepareDocuments(originalJson, modifiedJson) {
  return {
    normalizedOriginal: normalizeDocument(originalJson),
    normalizedModified: normalizeDocument(modifiedJson),
  };
}

export function normalizeDocument(document) {
  return JSON.parse(JSON.stringify(document));
}

export function compareIgnoringFormatting(obj1, obj2) {
  const normalized1 = normalizeDocument(obj1);
  const normalized2 = normalizeDocument(obj2);

  return diff(normalized1, normalized2);
}

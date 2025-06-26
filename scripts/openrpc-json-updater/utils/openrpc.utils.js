// SPDX-License-Identifier: Apache-2.0

import { shouldSkipKey, shouldSkipPath } from '../config.js';
import { compareIgnoringFormatting } from '../operations/prepare.js';

export function getMethodMap(openrpcDoc) {
  const map = new Map();
  if (Array.isArray(openrpcDoc.methods)) {
    for (const m of openrpcDoc.methods) {
      if (m?.name) map.set(m.name, m);
    }
  }
  return map;
}

function hasKey(obj, path) {
  if (!path) return false;
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (current === undefined || current === null || typeof current !== 'object') {
      return false;
    }

    if (!(part in current)) {
      return false;
    }

    current = current[part];
  }

  return true;
}

export function groupPaths(paths, minGroupSize = 3) {
  if (!paths || paths.length === 0) return '-';
  if (paths.length === 1) return paths[0];

  function getDepth(path) {
    return path.split('.').length;
  }

  function analyzePrefixes(paths) {
    const prefixCounters = {};

    for (const path of paths) {
      const parts = path.split('.');
      let currentPrefix = '';

      for (let i = 0; i < parts.length - 1; i++) {
        currentPrefix = currentPrefix ? `${currentPrefix}.${parts[i]}` : parts[i];
        prefixCounters[currentPrefix] = (prefixCounters[currentPrefix] || 0) + 1;
      }
    }

    return Object.keys(prefixCounters)
      .filter((prefix) => prefixCounters[prefix] >= minGroupSize)
      .sort((a, b) => {
        const countDiff = prefixCounters[b] - prefixCounters[a];
        if (countDiff !== 0) return countDiff;

        const depthA = getDepth(a);
        const depthB = getDepth(b);
        return depthB - depthA;
      });
  }

  function getSubpaths(paths, prefix) {
    return paths.filter((path) => path.startsWith(prefix + '.') || path === prefix);
  }

  function groupPathsHierarchically(paths) {
    const remainingPaths = [...paths];
    const result = [];

    const commonPrefixes = analyzePrefixes(paths);

    for (const prefix of commonPrefixes) {
      const matchingPaths = getSubpaths(remainingPaths, prefix);

      if (matchingPaths.length >= minGroupSize) {
        for (const path of matchingPaths) {
          const index = remainingPaths.indexOf(path);
          if (index !== -1) {
            remainingPaths.splice(index, 1);
          }
        }

        result.push(`${prefix} (${matchingPaths.length} diffs)`);
      }
    }

    result.push(...remainingPaths);

    return result;
  }

  const groupedPaths = groupPathsHierarchically(paths);
  return groupedPaths.join(', ');
}

export function getDifferingKeysByCategory(origMethod, modMethod) {
  const result = {
    valueDiscrepancies: [],
  };

  const differences = compareIgnoringFormatting(origMethod, modMethod) || [];

  // Process differences from comparison
  processDifferences(differences, origMethod, modMethod, result);

  // Find missing keys in original method
  findMissingKeys('', origMethod, modMethod, result);

  return result;
}

function processDifferences(differences, origMethod, modMethod, result) {
  for (const difference of differences) {
    if (!difference.path) continue;

    const fullPath = difference.path.join('.');

    if (shouldSkipDifferencePath(fullPath)) continue;

    categorizeDifference(fullPath, origMethod, modMethod, result);
  }
}

function shouldSkipDifferencePath(fullPath) {
  return !fullPath || fullPath.startsWith('name') || shouldSkipPath(fullPath);
}

function categorizeDifference(fullPath, origMethod, modMethod, result) {
  const existsInOrig = hasKey(origMethod, fullPath);
  const existsInMod = hasKey(modMethod, fullPath);

  if (existsInOrig && existsInMod) {
    result.valueDiscrepancies.push(fullPath);
  }
}

function findMissingKeys(prefix, orig, mod, result) {
  for (const key in orig) {
    if (shouldSkipKey(key)) continue;

    const newPrefix = buildPath(prefix, key);

    if (shouldSkipMissingKeyPath(newPrefix)) continue;

    if (isKeyMissing(key, mod)) {
      result.valueDiscrepancies.push(newPrefix);
    } else if (shouldRecurseIntoObjects(orig[key], mod[key])) {
      findMissingKeys(newPrefix, orig[key], mod[key], result);
    }
  }
}

function buildPath(prefix, key) {
  return prefix ? `${prefix}.${key}` : key;
}

function shouldSkipMissingKeyPath(path) {
  return path === 'name' || shouldSkipPath(path);
}

function isKeyMissing(key, obj) {
  return !(key in obj);
}

function shouldRecurseIntoObjects(origValue, modValue) {
  return isNonArrayObject(origValue) && isNonArrayObject(modValue);
}

function isNonArrayObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getDifferingKeys(origMethod, modMethod) {
  const { valueDiscrepancies } = getDifferingKeysByCategory(origMethod, modMethod);
  return [...new Set(valueDiscrepancies)];
}

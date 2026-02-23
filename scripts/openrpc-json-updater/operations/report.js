// SPDX-License-Identifier: Apache-2.0

import { FORK_NOT_YET_SUPPORTED_SKIP_LIST,getSkippedMethodCategory, NOT_YET_SUPPORTED_SKIP_LIST } from '../config.js';
import { getDifferingKeysByCategory, getMethodMap, groupPaths } from '../utils/openrpc.utils.js';

export async function generateReport(originalJson, modifiedJson) {
  const originalMethods = getMethodMap(originalJson);
  const modifiedMethods = getMethodMap(modifiedJson);

  const missingMethods = [];

  // Pre-listed missing methods by policy
  for (const method of NOT_YET_SUPPORTED_SKIP_LIST) {
    missingMethods.push({
      missingMethod: method,
      status: 'not yet supported',
    });
  }
  for (const method of FORK_NOT_YET_SUPPORTED_SKIP_LIST) {
    missingMethods.push({
      missingMethod: method,
      status: 'fork not yet supported',
    });
  }
  for (const name of originalMethods.keys()) {
    if (!modifiedMethods.has(name)) {
      const alreadyReported = missingMethods.some(item => item.missingMethod === name);
      if (!alreadyReported) {
        const category = getSkippedMethodCategory(name);
        missingMethods.push({
          missingMethod: name,
          status: category ? `${category}` : 'a new method',
        });
      }
    }
  }

  const changedMethods = [];
  for (const [name, origMethod] of originalMethods) {
    if (!modifiedMethods.has(name)) continue;
    const category = getSkippedMethodCategory(name);
    if (
      category === 'non supported' ||
      category === 'not yet supported' ||
      category === 'fork not yet supported'
    ) {
      continue;
    }
    const modMethod = modifiedMethods.get(name);

    const { valueDiscrepancies } = getDifferingKeysByCategory(origMethod, modMethod);
    if (valueDiscrepancies.length > 0) {
      changedMethods.push({
        method: name,
        valueDiscrepancies: groupPaths(valueDiscrepancies, 3),
      });
    }
  }

  if (missingMethods.length === 0 && changedMethods.length === 0) {
    console.log('No differences detected.');
    return;
  }

  if (missingMethods.length > 0) {
    console.log('\nMethods present in the original document but missing from the modified document:\n');
    console.table(missingMethods);
    console.log('\nStatus explanation:');
    console.log('- (non supported): Methods that we will not support');
    console.log('- (not yet supported): Methods planned but not yet implemented due to prioritization');
    console.log('- (fork not yet supported): Methods planned but pending fork support');
    console.log('- (overwritten): Methods supported with hardcoded/adjusted behavior');
  }

  if (changedMethods.length > 0) {
    console.log('\nMethods with differences between documents:\n');
    console.table(changedMethods, ['method', 'valueDiscrepancies']);
    console.log('\nExplanation:');
    console.log('- valueDiscrepancies: Fields that exist in both documents but have different values');
    console.log('- Entries with format "path (N diffs)" indicate N differences within that path');
  }
}

// SPDX-License-Identifier: Apache-2.0

import { getSkippedMethodCategory } from '../config.js';
import { getDifferingKeysByCategory, getMethodMap, groupPaths } from '../utils/openrpc.utils.js';

export async function generateReport(originalJson, modifiedJson) {
  const originalMethods = getMethodMap(originalJson);
  const modifiedMethods = getMethodMap(modifiedJson);

  const missingMethods = [];
  for (const name of originalMethods.keys()) {
    if (!modifiedMethods.has(name)) {
      const category = getSkippedMethodCategory(name);
      missingMethods.push({
        missingMethod: name,
        status: category ? `${category}` : 'a new method',
      });
    }
  }

  const changedMethods = [];
  for (const [name, origMethod] of originalMethods) {
    if (!modifiedMethods.has(name)) continue;
    const modMethod = modifiedMethods.get(name);

    const { valueDiscrepancies, customFields } = getDifferingKeysByCategory(origMethod, modMethod);
    if (valueDiscrepancies.length > 0 || customFields.length > 0) {
      changedMethods.push({
        method: name,
        valueDiscrepancies: groupPaths(valueDiscrepancies, 3),
        customFields: groupPaths(customFields, 3),
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
    console.log('- (discarded): Methods that have been intentionally removed');
    console.log('- (not implemented): Methods that have not been implemented yet');
  }

  if (changedMethods.length > 0) {
    console.log('\nMethods with differences between documents:\n');
    console.table(changedMethods, ['method', 'valueDiscrepancies', 'customFields']);
    console.log('\nExplanation:');
    console.log('- valueDiscrepancies: Fields that exist in both documents but have different values');
    console.log('- customFields: Fields that exist only in the modified document (custom additions)');
    console.log('- Entries with format "path (N diffs)" indicate N differences within that path');
  }
}

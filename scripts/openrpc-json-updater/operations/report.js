// SPDX-License-Identifier: Apache-2.0

import {
  FORK_NOT_YET_IMPLEMENTED_SKIP_LIST,
  getSkippedMethodCategory,
  NOT_YET_IMPLEMENTED_SKIP_LIST,
  OVERWRITTEN_SKIP_FIELDS,
  SKIP_CATEGORIES,
} from '../config.js';
import { getDifferingKeysByCategory, getMethodMap, groupPaths } from '../utils/openrpc.utils.js';
import { mergeDocuments } from './merge.js';

export async function generateReportMarkdown(originalJson, modifiedJson) {
  const { changedMethods, missingMethods } = await computeDifferences(originalJson, modifiedJson);
  const lines = [];
  lines.push('# OpenRPC JSON Update');
  lines.push('');
  lines.push('This PR updates the OpenRPC JSON specification with the latest changes from Ethereum JSON-RPC specification.');
  lines.push('');
  lines.push('## Comparison report');
  lines.push('');
  if (missingMethods.length === 0 && changedMethods.length === 0) {
    lines.push('No differences detected.');
    return lines.join('\n');
  }

  if (missingMethods.length > 0) {
    lines.push('## Methods missing from modified document');
    lines.push('');
    lines.push(renderMarkdownTable(['Method', 'Status'], missingMethods.map(m => ({ Method: m.missingMethod, Status: m.status }))));
    lines.push('');
  }

  lines.push('## Methods with differences');
  lines.push('');
  const rows = changedMethods.map((m) => ({
    Method: m.method,
    Differences: Array.isArray(m.valueDiscrepancies) ? m.valueDiscrepancies.join('<br>') : String(m.valueDiscrepancies),
    Status: 'to review',
  }));
  OVERWRITTEN_SKIP_FIELDS.forEach(field => {
    const methodName = field.split('.')[0];
    const fieldName = field.replace(`${methodName}.`, '');
    const exists = rows.find(row => row.Method === methodName && row.Status === SKIP_CATEGORIES.OVERWRITTEN);
    if (exists) {
      exists.DifferencesArray.push(fieldName);
      const formatted = groupPaths(exists.DifferencesArray, 3);
      exists.Differences = Array.isArray(formatted) ? formatted.join('<br>') : String(formatted);
      return;
    }
    rows.push({
      Method: methodName,
      Differences: fieldName,
      Status: SKIP_CATEGORIES.OVERWRITTEN,
      DifferencesArray: [fieldName],
    });
  });
  lines.push(renderMarkdownTable(['Method', 'Differences', 'Status'], rows));
  lines.push('');
  lines.push('#### Explanation');
  lines.push('- Differences: Fields that exist in both documents but have different values');
  lines.push('- Entries with format "path (N diffs)" indicate N differences within that path');
  lines.push('');
  lines.push('#### Status explanation');
  lines.push(`- (${SKIP_CATEGORIES.NOT_SUPPORTED}): Methods that we will not support`);
  lines.push(`- (${SKIP_CATEGORIES.NOT_YET_IMPLEMENTED}): Methods planned but not yet implemented due to prioritization`);
  lines.push(`- (${SKIP_CATEGORIES.FORK_NOT_YET_IMPLEMENTED}): Methods planned but pending fork support`);
  lines.push(`- (${SKIP_CATEGORIES.OVERWRITTEN}): Methods supported with hardcoded/adjusted behavior`);
  lines.push('- (to review): Unexpected differences that require further review');
  lines.push('');

  return lines.join('\n');
}

function renderMarkdownTable(headers, rows) {
  if (!rows || rows.length === 0) {
    return '_None_';
  }
  const escape = (v) =>
    String(v ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|');
  const headerLine = `| ${headers.join(' | ')} |`;
  const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((row) => {
    const cells = headers.map((h) => escape(row[h]));
    return `| ${cells.join(' | ')} |`;
  });
  return [headerLine, sepLine, ...rowLines].join('\n');
}

async function computeDifferences(originalJson, modifiedJson) {
  const originalMethods = getMethodMap(originalJson);
  const modifiedMethods = getMethodMap(modifiedJson);

  const missingMethods = [];

  // Pre-listed missing methods by policy
  for (const method of NOT_YET_IMPLEMENTED_SKIP_LIST) {
    missingMethods.push({
      missingMethod: method,
      status: SKIP_CATEGORIES.NOT_YET_IMPLEMENTED,
    });
  }
  for (const method of FORK_NOT_YET_IMPLEMENTED_SKIP_LIST) {
    missingMethods.push({
      missingMethod: method,
      status: SKIP_CATEGORIES.FORK_NOT_YET_IMPLEMENTED,
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

  const changes = getMethodMap(mergeDocuments(originalJson, modifiedJson));

  const changedMethods = [];
  for (const [name, origMethod] of changes) {
    if (!modifiedMethods.has(name)) continue;
    const category = getSkippedMethodCategory(name);
    if (
      category === SKIP_CATEGORIES.NOT_SUPPORTED ||
      category === SKIP_CATEGORIES.NOT_YET_IMPLEMENTED ||
      category === SKIP_CATEGORIES.FORK_NOT_YET_IMPLEMENTED
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

  return { missingMethods, changedMethods };
}

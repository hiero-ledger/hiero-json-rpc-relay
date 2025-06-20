// SPDX-License-Identifier: Apache-2.0

import { mergeDocuments } from './operations/merge.js';
import { compareIgnoringFormatting, prepareDocuments } from './operations/prepare.js';
import { generateReport } from './operations/report.js';
import { readJson, writeJson } from './utils/file.utils.js';

const originalFilePath = './original-openrpc.json';
const modifiedFilePath = '../../docs/openrpc.json';

const { data: originalJson } = readJson(originalFilePath);
const { data: modifiedJson, originalContent: modifiedContent } = readJson(modifiedFilePath);

function parseArgs() {
  const argv = process.argv.slice(2);
  const result = { mergeFlag: false };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '-g':
      case '--merge':
        result.mergeFlag = true;
        break;
    }
  }
  return result;
}

function hasDifferences(original, merged) {
  const differences = compareIgnoringFormatting(original, merged);
  return differences && differences.length > 0;
}

(async () => {
  const { mergeFlag } = parseArgs();

  const { normalizedOriginal, normalizedModified } = prepareDocuments(originalJson, modifiedJson);

  if (mergeFlag) {
    const merged = mergeDocuments(normalizedOriginal, normalizedModified);

    if (!hasDifferences(normalizedModified, merged)) {
      console.log(`\nNo differences found after merge. No changes needed.\n`);
      process.exit(0);
    }

    writeJson(modifiedFilePath, merged, modifiedContent);
    console.log(`\nMerge completed. Updated file: '${modifiedFilePath}'.\n`);
    return;
  }

  await generateReport(normalizedOriginal, normalizedModified).catch((err) => {
    console.error('Unexpected error while generating report:', err);
    process.exit(1);
  });
})();

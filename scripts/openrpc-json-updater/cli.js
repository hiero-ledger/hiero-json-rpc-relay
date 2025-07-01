// SPDX-License-Identifier: Apache-2.0

import { mergeDocuments } from './operations/merge.js';
import { compareIgnoringFormatting, prepareDocuments } from './operations/prepare.js';
import { generateReport } from './operations/report.js';
import { readJson, writeJson } from './utils/file.utils.js';

const DEFAULT_ORIGINAL_FILE_PATH = './original-openrpc.json';
const DEFAULT_MODIFIED_FILE_PATH = '../../docs/openrpc.json';

function parseArgs() {
  const argv = process.argv.slice(2);
  const result = {
    mergeFlag: false,
    originalFilePath: DEFAULT_ORIGINAL_FILE_PATH,
    modifiedFilePath: DEFAULT_MODIFIED_FILE_PATH,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '-g':
      case '--merge':
        result.mergeFlag = true;
        break;
      case '-o':
      case '--original':
        if (i + 1 < argv.length) {
          result.originalFilePath = argv[++i];
        }
        break;
      case '-m':
      case '--modified':
        if (i + 1 < argv.length) {
          result.modifiedFilePath = argv[++i];
        }
        break;
    }
  }
  return result;
}

const { mergeFlag, originalFilePath, modifiedFilePath } = parseArgs();

const { data: originalJson } = readJson(originalFilePath);
const { data: modifiedJson, originalContent: modifiedContent } = readJson(modifiedFilePath);

function hasDifferences(original, merged) {
  const differences = compareIgnoringFormatting(original, merged);
  return differences && differences.length > 0;
}

(async () => {
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

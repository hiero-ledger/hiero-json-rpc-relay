// SPDX-License-Identifier: Apache-2.0

// CI-only ESLint config — extends the base config with type-aware rules.
// These rules require parserOptions.project (full TypeScript program build)
// and are too expensive to run on every save locally.
// Run via: npx eslint . --config eslint.config.ci.mjs

import { defineConfig } from 'eslint/config';
import tsParser from '@typescript-eslint/parser';
import baseConfig from './eslint.config.mjs';

export default defineConfig([
  ...baseConfig,

  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
]);

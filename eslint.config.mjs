// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import nPlugin from 'eslint-plugin-n';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

// Custom inline plugin for header checking
const headerRule = {
  create(context) {
    return {
      Program(node) {
        const comments = context.sourceCode.getAllComments();
        const hasHeader = comments[0]?.value.trim() === 'SPDX-License-Identifier: Apache-2.0';

        if (!hasHeader) {
          context.report({ node, message: 'Missing SPDX license header' });
        }
      },
    };
  },
};

export default defineConfig([
  // Global ignores
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/coverage/**', '**/*.d.ts', 'tools/**',
      'dapp-example/**', 'k6/**', 'scripts/**', '.github/**', 'docs/**'],
  },

  // Main configuration for all TS files
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tsPlugin,
      'simple-import-sort': simpleImportSort,
      n: nPlugin,
      local: {
        rules: {
          header: headerRule,
        },
      },
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      globals: {
        ...globals.node,
        ...globals.es2021,
        __ENV: 'readonly',
        NodeJS: 'readonly',
      },
    },
    rules: {
      // Base recommended JS rules applied to TS
      ...js.configs.recommended.rules,
      // Merge recommended TypeScript rules
      ...tsPlugin.configs.recommended.rules,
      // Merge prettier config rules (disables conflicting rules)
      ...prettierConfig.rules,
      // Custom rules
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-trailing-spaces': 'error',
      'no-useless-escape': 'warn',
      'prefer-const': 'error',
      'eqeqeq': ["error", "always", { "null": "ignore" }],
      'no-console': 'warn',
      'comma-dangle': [
        'error',
        {
          arrays: 'always-multiline',
          objects: 'always-multiline',
          imports: 'always-multiline',
          exports: 'always-multiline',
          functions: 'always-multiline',
        },
      ],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'off',
      // Type-aware rules — require parserOptions.project -> this can significantly increase CPU usage
      // '@typescript-eslint/no-floating-promises': 'error',
      // '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      'n/no-process-exit': 'error',
    },
  },

  // SPDX header required only on source and test files
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'local/header': 'error',
    },
  },

  // Test files - relaxed rules
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.mocha,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-console': 'off',
    },
  },
]);

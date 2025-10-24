// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
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
    ignores: ['**/node_modules/**', '**/dist/**'],
  },

  // Base recommended configs
  js.configs.recommended,

  // Main configuration for all JS/TS files
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.ts'],
    plugins: {
      '@typescript-eslint': tsPlugin,
      'simple-import-sort': simpleImportSort,
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
      // Merge recommended TypeScript rules
      ...tsPlugin.configs.recommended.rules,
      // Merge prettier config rules (disables conflicting rules)
      ...prettierConfig.rules,
      // Custom rules
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-var-requires': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-trailing-spaces': 'error',
      'no-useless-escape': 'warn',
      'prefer-const': 'error',
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
      'local/header': 'error',
    },
  },

  // Config for eslint config files themselves
  {
    files: ['eslint.config.js', '.eslintrc.{js,cjs}'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
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
    },
  },
]);

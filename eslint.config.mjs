// SPDX-License-Identifier: Apache-2.0

import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import headerPlugin from "@tony.ganchev/eslint-plugin-header";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
    // Apply recommended configs
    js.configs.recommended,
    ...tseslint.configs.recommended,
    eslintConfigPrettier,

    // Main configuration
    {
        files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.ts"],
        
        plugins: {
            "simple-import-sort": simpleImportSort,
            "header": headerPlugin,
        },

        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.node,
                ...globals.es2021,
                "__ENV": "readonly",
            },
        },

        rules: {
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-var-requires": "warn",
            "@typescript-eslint/no-require-imports": "warn",
            "@typescript-eslint/no-unused-vars": "warn",
            "no-trailing-spaces": "error",
            "no-useless-escape": "warn",
            "prefer-const": "error",
            "comma-dangle": ["error", {
                "arrays": "always-multiline",
                "objects": "always-multiline",
                "imports": "always-multiline",
                "exports": "always-multiline",
                "functions": "always-multiline",
            }],
            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "off",
            "header/header": ["error", "line", [" SPDX-License-Identifier: Apache-2.0"]],
        },
    },

    // Configuration for eslintrc config files (if any remain)
    {
        files: [".eslintrc.{js,cjs}"],
        languageOptions: {
            sourceType: "script",
            globals: {
                ...globals.node,
            },
        },
    },

    // Configuration for test files
    {
        files: [
            "**/*.spec.ts",
            "**/*.test.ts",
            "**/tests/**/*.ts",
        ],
        rules: {
            "@typescript-eslint/no-unused-expressions": "off",
        },
    },

    // Ignore patterns
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
        ],
    },
];

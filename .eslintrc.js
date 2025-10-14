// SPDX-License-Identifier: Apache-2.0

module.exports = {
    "env": {
        "node": true,
        "es2021": true,
    },
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "prettier",
    ],
    "globals": {
        "__ENV": "readonly",
    },
    "plugins": [
        "simple-import-sort",
        "header",
    ],
    "overrides": [
        {
            "env": {
                "node": true,
            },
            "files": [
                ".eslintrc.{js,cjs}",
            ],
            "parserOptions": {
                "sourceType": "script",
            },
        },
    ],
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module",
    },
    "rules": {
        "@typescript-eslint/ban-ts-comment": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-var-requires": "warn",
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
        "header/header": [2, "line", [" SPDX-License-Identifier: Apache-2.0"]],
    },
};

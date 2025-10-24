### Description

This PR migrates the project from ESLint 8.48.0 to 9.34.0 by adopting the new flat config format. The upgrade was blocked by removed CLI flags (`--ignore-path`, `--ext`) and deprecated configuration format (`.eslintrc.js`).

**Key Changes:**

- Created `eslint.config.mjs` with flat config format (replaced `.eslintrc.js` and `.eslintignore`) - [ESLint Migration Guide](https://eslint.org/docs/latest/use/configure/migration-guide)
- Installed `@eslint/js@9.38.0` - required for flat config ([ESLint v9 Breaking Changes](https://eslint.org/docs/latest/use/migrate-to-9.0.0#-eslintrecommended-and-eslintall))
- Installed `globals@15.14.0` - standard for environment globals ([Flat Config Language Options](https://eslint.org/docs/latest/use/configure/migration-guide#configuring-language-options))
- Installed `typescript-eslint@8.46.2` - unified package replacing `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` ([TypeScript ESLint v7 Announcement](https://typescript-eslint.io/blog/announcing-typescript-eslint-v7))
- Replaced `eslint-plugin-header@3.1.1` with `@tony.ganchev/eslint-plugin-header@3.1.8` (ESLint 9 compatible fork)
- Updated all package.json lint scripts to remove deprecated CLI flags
- Removed unused `@eslint/compat` dependency
- Fixed pre-existing lint errors (empty catch block, unused imports)

### Related issue(s)

Fixes # <!-- Add issue number after creating the issue from NewIssue.md -->

### Testing Guide

1. Run `npm run lint` - ESLint should execute without configuration errors (no "Invalid option '--ignore-path'" error)
2. Run `npx lerna run lint` - should run ESLint across all packages using the new flat config
3. Make a change to any `.ts` file and run `git commit` - pre-commit hooks should execute ESLint and Prettier without configuration errors

### Changes from original design (optional)

N/A

### Additional work needed (optional)

Pre-existing lint errors (30 total: 3 errors, 27 warnings) remain in the codebase and should be addressed in a follow-up PR. These are unrelated to the ESLint 9 migration.

### Checklist

- [ ] I've assigned an assignee to this PR and related issue(s) (if applicable)
- [ ] I've assigned a label to this PR and related issue(s) (if applicable)
- [ ] I've assigned a milestone to this PR and related issue(s) (if applicable)
- [ ] I've updated documentation (code comments, README, etc. if applicable)
- [ ] I've done sufficient testing (unit, integration, etc.)

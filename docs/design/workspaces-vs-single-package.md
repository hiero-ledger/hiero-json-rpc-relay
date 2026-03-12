# npm Workspaces vs Single Package

## Overview

When removing Lerna, the team must decide whether to keep the existing 4-package workspace structure or collapse everything into a single package. This document compares both options in the context of this project.

## Current structure (4 packages)

```
packages/
  config-service/   → @hashgraph/json-rpc-config-service
  relay/            → @hashgraph/json-rpc-relay
  server/           → @hashgraph/json-rpc-server
  ws-server/        → @hashgraph/json-rpc-ws-server
```

Each has its own `package.json`, `tsconfig.json`, and `node_modules` symlink.

---

## Option A: Keep npm Workspaces

Lerna is removed. Package structure is unchanged. Scripts are replaced with npm workspace equivalents.

**Pros:**

- Zero import changes — 335 cross-package imports across 134 files are untouched
- No merge conflicts with open PRs
- Clear enforced boundaries — `ws-server` cannot accidentally import from `server`'s internals
- Each package can be built and tested in isolation (`npm run test -w @hashgraph/json-rpc-relay`)
- Consistent with how the dependency graph is already documented and understood

**Cons:**

- Still 5 `package.json` files to keep in sync (name, version, deps)
- `npm run --workspaces` requires explicit workspace ordering to guarantee build order (see [remove-lerna-unified-entrypoint.md](./remove-lerna-unified-entrypoint.md))
- Slightly more cognitive overhead for new contributors vs a flat project

---

## Option B: Single Package

All packages are collapsed into one. `config-service`, `relay`, `server`, `ws-server` become plain folders under `src/`.

**Pros:**

- One `package.json`, one `tsconfig.json`, one `tsc -b` build
- Simpler mental model — no workspace concept to explain
- Imports become relative paths, eliminating the `dist/` indirection (e.g. `@hashgraph/json-rpc-relay/dist/lib/...` → `../../relay/lib/...`)

**Cons:**

- 335 import statements across 134 files must be rewritten
- 4 `tsconfig.json` files must be merged or converted to project references
- All open PRs conflict on import paths — every branch becomes a rebase exercise
- No package-level isolation: a test file in `ws-server` can freely import `server` internals with no visibility boundary
- All dependencies collapse into one `package.json` — harder to reason about what `config-service` actually needs vs what `relay` needs
- No meaningful functional difference — the unified entrypoint works identically either way

---
